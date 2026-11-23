
import json
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf

from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.utils.class_weight import compute_class_weight
from tensorflow.keras import layers, models
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

# -----------------------------
# 1. Configuration
# -----------------------------
SEED = 42
IMAGE_SIZE = (224, 224)
BATCH_SIZE = 32
EPOCHS = 15
FINE_TUNE_EPOCHS = 8
FINE_TUNE_LAYERS = 30

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "dataset" / "train.csv"
LABEL_MAP_PATH = ROOT / "dataset" / "label_num_to_disease_map.json"
IMAGE_DIR = ROOT / "dataset" / "train_images"
NON_CASSAVA_DIR = ROOT / "dataset" / "non_cassava"
MODEL_DIR = ROOT / "models"
ACTIVE_MODEL_PATH = MODEL_DIR / "cassava_model.keras"
CANDIDATE_MODEL_PATH = MODEL_DIR / "cassava_model_candidate.keras"
CANDIDATE_CLASS_NAMES_PATH = MODEL_DIR / "class_names_candidate.json"
STAGE_MODEL_PATH = MODEL_DIR / "cassava_model_training_stage.keras"

MODEL_DIR.mkdir(parents=True, exist_ok=True)

tf.keras.utils.set_random_seed(SEED)

# Class order must match the dataset and the CADD app.
CLASS_NAMES = {
    0: "cbb",
    1: "cbsd",
    2: "cgm",
    3: "cmd",
    4: "healthy",
}
NON_CASSAVA_CLASS = "not_cassava"
EXPECTED_DATASET_LABELS = {
    0: "Cassava Bacterial Blight (CBB)",
    1: "Cassava Brown Streak Disease (CBSD)",
    2: "Cassava Green Mottle (CGM)",
    3: "Cassava Mosaic Disease (CMD)",
    4: "Healthy",
}

# -----------------------------
# 2. Load and validate labels
# -----------------------------
with open(LABEL_MAP_PATH, "r", encoding="utf-8") as file:
    dataset_labels = {int(key): str(value) for key, value in json.load(file).items()}
if dataset_labels != EXPECTED_DATASET_LABELS:
    raise ValueError(
        "label_num_to_disease_map.json does not match the expected cassava label order."
    )

df = pd.read_csv(CSV_PATH)

required_columns = {"image_id", "label"}
if not required_columns.issubset(df.columns):
    raise ValueError(
        f"CSV must contain columns {required_columns}. "
        f"Found: {list(df.columns)}"
    )

df["label"] = df["label"].astype(int)

if not df["label"].isin(CLASS_NAMES.keys()).all():
    raise ValueError("Found a label outside the expected range 0-4.")

df["filepath"] = df["image_id"].apply(
    lambda name: str(IMAGE_DIR / str(name))
)

missing = [p for p in df["filepath"] if not Path(p).is_file()]
if missing:
    raise FileNotFoundError(
        f"{len(missing)} images are missing. Example: {missing[0]}"
    )

negative_images = sorted(
    path
    for path in NON_CASSAVA_DIR.rglob("*")
    if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"}
) if NON_CASSAVA_DIR.is_dir() else []
if negative_images:
    if len(negative_images) < 100:
        raise ValueError(
            "Add at least 100 varied non-cassava images before training "
            "the not_cassava class."
        )
    CLASS_NAMES[5] = NON_CASSAVA_CLASS
    negative_df = pd.DataFrame({
        "image_id": [str(path.relative_to(ROOT)) for path in negative_images],
        "label": 5,
        "filepath": [str(path) for path in negative_images],
    })
    df = pd.concat([df, negative_df], ignore_index=True)

NUM_CLASSES = len(CLASS_NAMES)

print("Images found:", len(df))
print(df["label"].value_counts().sort_index())
if negative_images:
    print(
        f"Non-cassava images: {len(negative_images)}. "
        "Include diverse plants and non-leaf images."
    )
else:
    print(
        "No non-cassava images found; this candidate can only classify "
        "the five cassava classes."
    )

# -----------------------------
# 3. Split training and validation data
# -----------------------------
train_df, val_df = train_test_split(
    df,
    test_size=0.20,
    random_state=SEED,
    stratify=df["label"],
)

print("Training images:", len(train_df))
print("Validation images:", len(val_df))

# -----------------------------
# 4. Build the image pipeline
# -----------------------------
def load_image(path, label):
    image_bytes = tf.io.read_file(path)
    image = tf.io.decode_image(
        image_bytes,
        channels=3,
        expand_animations=False,
    )
    image.set_shape([None, None, 3])
    image = tf.image.resize(image, IMAGE_SIZE)
    image = preprocess_input(image)
    label = tf.cast(label, tf.int32)
    return image, label

def make_dataset(frame, training=False):
    paths = frame["filepath"].values
    labels = frame["label"].values.astype("int32")

    ds = tf.data.Dataset.from_tensor_slices((paths, labels))

    if training:
        ds = ds.shuffle(
            buffer_size=len(frame),
            seed=SEED,
            reshuffle_each_iteration=True,
        )

    ds = ds.map(
        load_image,
        num_parallel_calls=tf.data.AUTOTUNE,
    )

    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)

train_ds = make_dataset(train_df, training=True)
val_ds = make_dataset(val_df)

def build_classifier(base_model, output_count):
    base_model.trainable = False

    inputs = layers.Input(shape=(*IMAGE_SIZE, 3))
    x = layers.RandomFlip("horizontal")(inputs)
    x = layers.RandomRotation(0.08)(x)
    x = layers.RandomZoom(0.10)(x)
    x = base_model(x, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.30)(x)
    outputs = layers.Dense(output_count, activation="softmax")(x)
    return models.Model(inputs, outputs)

def get_mobilenet_base(source_model):
    base = next(
        (
            layer
            for layer in source_model.layers
            if isinstance(layer, tf.keras.Model)
            and layer.name.startswith("mobilenetv2")
        ),
        None,
    )
    if base is None:
        raise ValueError("The active model does not contain a MobileNetV2 feature extractor.")
    return base

# Give more weight to classes that have fewer examples.
weights = compute_class_weight(
    class_weight="balanced",
    classes=np.array(sorted(CLASS_NAMES.keys())),
    y=train_df["label"].values,
)
class_weights = {
    i: float(weight) for i, weight in enumerate(weights)
}

# -----------------------------
# 5. Build MobileNetV2 model
# -----------------------------
expected_classes = [CLASS_NAMES[index] for index in sorted(CLASS_NAMES)]
best_loss = float("inf")
best_accuracy = 0.0
model = None
base_model = None

if ACTIVE_MODEL_PATH.is_file():
    active_model = tf.keras.models.load_model(ACTIVE_MODEL_PATH)
    with open(MODEL_DIR / "class_names.json", "r", encoding="utf-8") as file:
        active_classes = {
            int(key): str(value)
            for key, value in json.load(file).items()
        }
    if set(active_classes) != set(range(len(active_classes))):
        raise ValueError("The active class mapping keys must be contiguous and start at zero.")
    if active_model.output_shape[-1] != len(active_classes):
        raise ValueError("The active model and class_names.json have different output counts.")

    base_model = get_mobilenet_base(active_model)
    active_order = [active_classes[index] for index in range(len(active_classes))]
    if active_order == expected_classes:
        model = active_model
        base_model.trainable = False
        best_loss, best_accuracy = model.evaluate(val_ds, verbose=1)
        model.save(CANDIDATE_MODEL_PATH)
        print("Starting from the active model; its validation result is the safety baseline.")
    elif active_order == ["cbb", "cbsd", "cgm", "cmd", "healthy"] and expected_classes[-1:] == [NON_CASSAVA_CLASS]:
        model = build_classifier(base_model, NUM_CLASSES)
        print("Reusing the active MobileNetV2 features and adding a not_cassava output.")
    else:
        raise ValueError(
            "The active model classes do not match this training dataset. "
            "Restore the matching dataset or active class mapping before training."
        )
else:
    base_model = MobileNetV2(
        input_shape=(*IMAGE_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )
    model = build_classifier(base_model, NUM_CLASSES)
    print("No active model found; initializing the MobileNetV2 feature extractor from ImageNet.")

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)

model.summary()

# -----------------------------
# 6. Train the model
# -----------------------------
callbacks = [
    tf.keras.callbacks.EarlyStopping(
        monitor="val_loss",
        patience=4,
        restore_best_weights=True,
    ),
    tf.keras.callbacks.ModelCheckpoint(
        filepath=str(STAGE_MODEL_PATH),
        monitor="val_loss",
        save_best_only=True,
    ),
]

history = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=EPOCHS,
    class_weight=class_weights,
    callbacks=callbacks,
)

stage_model = tf.keras.models.load_model(STAGE_MODEL_PATH)
stage_loss, stage_accuracy = stage_model.evaluate(val_ds, verbose=1)
if stage_loss < best_loss:
    stage_model.save(CANDIDATE_MODEL_PATH)
    best_loss, best_accuracy = stage_loss, stage_accuracy
    print("Frozen-backbone training improved the validation baseline.")
else:
    print("Keeping the better validation baseline after frozen-backbone training.")
model = tf.keras.models.load_model(CANDIDATE_MODEL_PATH)
base_model = get_mobilenet_base(model)
if STAGE_MODEL_PATH.is_file():
    STAGE_MODEL_PATH.unlink()

# Fine-tune only the last MobileNetV2 layers, keeping batch-normalization
# statistics frozen so the smaller field dataset does not destabilize them.
base_model.trainable = True
for layer in base_model.layers[:-FINE_TUNE_LAYERS]:
    layer.trainable = False
for layer in base_model.layers:
    if isinstance(layer, layers.BatchNormalization):
        layer.trainable = False

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)
model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=FINE_TUNE_EPOCHS,
    class_weight=class_weights,
    callbacks=[
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=3,
            restore_best_weights=True,
        )
    ],
)

fine_tune_loss, fine_tune_accuracy = model.evaluate(val_ds, verbose=1)
if fine_tune_loss < best_loss:
    model.save(CANDIDATE_MODEL_PATH)
    best_loss, best_accuracy = fine_tune_loss, fine_tune_accuracy

best_model = tf.keras.models.load_model(CANDIDATE_MODEL_PATH)
validation_images = val_ds.map(lambda images, _labels: images)
predictions = best_model.predict(validation_images, verbose=1).argmax(axis=1)
true_labels = np.concatenate([labels.numpy() for _images, labels in val_ds])
class_ids = sorted(CLASS_NAMES)
print(f"Best candidate validation loss: {best_loss:.4f}")
print(f"Best candidate validation accuracy: {best_accuracy:.2%}")
print("Validation confusion matrix:")
print(confusion_matrix(true_labels, predictions, labels=class_ids))
print("Validation classification report:")
print(classification_report(
    true_labels,
    predictions,
    labels=class_ids,
    target_names=[CLASS_NAMES[class_id] for class_id in class_ids],
    zero_division=0,
))

with open(CANDIDATE_CLASS_NAMES_PATH, "w", encoding="utf-8") as file:
    json.dump(
        {str(k): v for k, v in CLASS_NAMES.items()},
        file,
        indent=2,
    )

print("Candidate model saved to:", CANDIDATE_MODEL_PATH)
print("Candidate class mapping saved to:", CANDIDATE_CLASS_NAMES_PATH)
print("The active model was not overwritten.")
