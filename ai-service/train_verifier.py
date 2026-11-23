import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
from tensorflow.keras import layers, models
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data" / "cassava_verification"
CASSAVA_DIR = DATA_DIR / "cassava"
NON_CASSAVA_DIR = DATA_DIR / "not_cassava"
LEGACY_DATA_DIR = ROOT / "dataset" / "verifier"
DISEASE_DATA_DIR = ROOT / "dataset"
MODEL_DIR = ROOT / "models"
CANDIDATE_PATH = MODEL_DIR / "cassava_verifier_candidate.keras"
REPORT_PATH = MODEL_DIR / "cassava_verifier_test_report.json"
IMAGE_SIZE = (224, 224)
BATCH_SIZE = 32
SEED = 42
EPOCHS = 15
MIN_CASSAVA_CONFIDENCE = float(os.getenv("CADD_MIN_CASSAVA_CONFIDENCE", "0.99"))
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

if not 0 <= MIN_CASSAVA_CONFIDENCE <= 1:
    raise ValueError("CADD_MIN_CASSAVA_CONFIDENCE must be between 0 and 1.")


def collect_images(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(
        path
        for path in folder.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )



def cassava_training_images() -> list[Path]:
    supplied_images = sorted(set(
        collect_images(CASSAVA_DIR)
        + collect_images(LEGACY_DATA_DIR / "cassava_leaf")
    ))

    if len(supplied_images) >= 100:
        print(
            f"Using {len(supplied_images)} cassava "
            "images from verifier folder."
        )
        return supplied_images

    # Otherwise, reuse the original cassava dataset
    print(
        "Not enough cassava images in verifier folder."
    )
    print("Loading original cassava training images...")

    labels_path = DISEASE_DATA_DIR / "train.csv"
    image_dir = DISEASE_DATA_DIR / "train_images"

    if not labels_path.is_file():
        raise FileNotFoundError(
            f"Missing training labels: {labels_path}"
        )

    if not image_dir.is_dir():
        raise FileNotFoundError(
            f"Missing training images: {image_dir}"
        )

    labels = pd.read_csv(labels_path)

    if not {"image_id", "label"}.issubset(labels.columns):
        raise ValueError(
            "train.csv must contain image_id and label columns."
        )

    if not labels["label"].isin(range(5)).all():
        raise ValueError(
            "Unknown cassava disease labels."
        )

    images = [
        image_dir / str(name)
        for name in labels["image_id"]
    ]

    missing = [path for path in images if not path.is_file()]

    if missing:
        raise FileNotFoundError(
            f"Missing cassava image: {missing[0]}"
        )

    print(
        f"Successfully loaded {len(images)} "
        "original cassava training images."
    )

    return images


def non_cassava_training_images() -> list[Path]:
    return sorted(set(
        collect_images(NON_CASSAVA_DIR)
        + collect_images(LEGACY_DATA_DIR / "not_leaf")
        + collect_images(LEGACY_DATA_DIR / "other_plant_leaf")
    ))


def split_image_frame(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    partition_names = {"train": "train", "val": "validation", "valid": "validation", "validation": "validation", "test": "test"}
    partitions = frame["path"].map(
        lambda value: next(
            (partition_names[part.lower()] for part in reversed(Path(value).parts) if part.lower() in partition_names),
            None,
        )
    )
    explicit = {
        "train": frame.loc[partitions == "train"],
        "validation": frame.loc[partitions == "validation"],
        "test": frame.loc[partitions == "test"],
    }
    unpartitioned = frame.loc[partitions.isna()]
    if len(unpartitioned):
        extra_train, remainder = train_test_split(
            unpartitioned,
            test_size=0.30,
            random_state=SEED,
            stratify=unpartitioned["label"],
        )
        extra_validation, extra_test = train_test_split(
            remainder,
            test_size=0.50,
            random_state=SEED,
            stratify=remainder["label"],
        )
        explicit["train"] = pd.concat([explicit["train"], extra_train])
        explicit["validation"] = pd.concat([explicit["validation"], extra_validation])
        explicit["test"] = pd.concat([explicit["test"], extra_test])
    return explicit["train"], explicit["validation"], explicit["test"]


def decode_image(path: tf.Tensor, label: tf.Tensor) -> tuple[tf.Tensor, tf.Tensor]:
    encoded = tf.io.read_file(path)
    image = tf.io.decode_image(encoded, channels=3, expand_animations=False)
    image.set_shape([None, None, 3])
    image = tf.image.resize(image, IMAGE_SIZE)
    return preprocess_input(image), tf.cast(label, tf.float32)


def make_dataset(frame: pd.DataFrame, training: bool = False) -> tf.data.Dataset:
    dataset = tf.data.Dataset.from_tensor_slices(
        (
            frame["path"].astype(str).to_numpy(dtype=str),
            frame["label"].to_numpy(dtype=np.float32),
        )
    )
    if training:
        dataset = dataset.shuffle(len(frame), seed=SEED, reshuffle_each_iteration=True)
    return dataset.map(
        decode_image,
        num_parallel_calls=tf.data.AUTOTUNE,
    ).batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)


def load_feature_extractor() -> tf.keras.Model:
    active_path = MODEL_DIR / "cassava_model.keras"
    if active_path.is_file():
        disease_model = tf.keras.models.load_model(active_path)
        feature_extractor = next(
            (
                layer
                for layer in disease_model.layers
                if isinstance(layer, tf.keras.Model)
                and layer.name.startswith("mobilenetv2")
            ),
            None,
        )
        if feature_extractor is not None:
            print("Reusing MobileNetV2 features from the existing cassava disease model.")
            return feature_extractor

    print("No reusable MobileNetV2 found; initializing ImageNet weights.")
    return MobileNetV2(
        input_shape=(*IMAGE_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )


def main() -> None:
    cassava_images = cassava_training_images()
    non_cassava_images = non_cassava_training_images()
    if len(cassava_images) < 100:
        raise ValueError(
            f"Need at least 100 cassava images; found {len(cassava_images)}."
        )
    if len(non_cassava_images) < 100:
        raise ValueError(
            "Need at least 100 varied non-cassava images in "
            f"{NON_CASSAVA_DIR}; found {len(non_cassava_images)}. "
            "Include other plant species and unsuitable images."
        )

    frame = pd.DataFrame({
        "path": [str(path) for path in cassava_images + non_cassava_images],
        "label": [0] * len(cassava_images) + [1] * len(non_cassava_images),
    })
    train_frame, validation_frame, test_frame = split_image_frame(frame)
    print("Class order: cassava=0, not_cassava=1")
    print(
        f"Split sizes: train={len(train_frame)}, validation={len(validation_frame)}, "
        f"test={len(test_frame)}"
    )
    print(f"Class counts:\n{frame['label'].value_counts().sort_index()}")

    train_data = make_dataset(train_frame, training=True)
    validation_data = make_dataset(validation_frame)
    test_data = make_dataset(test_frame)

    base_model = load_feature_extractor()
    base_model.trainable = False
    inputs = layers.Input(shape=(*IMAGE_SIZE, 3))
    augmented = layers.RandomFlip("horizontal")(inputs)
    augmented = layers.RandomRotation(0.08)(augmented)
    augmented = layers.RandomZoom(0.10)(augmented)
    features = base_model(augmented, training=False)
    features = layers.GlobalAveragePooling2D()(features)
    features = layers.Dropout(0.30)(features)
    outputs = layers.Dense(1, activation="sigmoid")(features)
    verifier = models.Model(inputs, outputs)
    verifier.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="binary_crossentropy",
        metrics=["accuracy", tf.keras.metrics.Precision(name="precision"), tf.keras.metrics.Recall(name="recall")],
    )

    weights = compute_class_weight(
        class_weight="balanced",
        classes=np.array([0, 1]),
        y=train_frame["label"].to_numpy(),
    )
    verifier.fit(
        train_data,
        validation_data=validation_data,
        epochs=EPOCHS,
        class_weight={0: float(weights[0]), 1: float(weights[1])},
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                monitor="val_loss",
                patience=4,
                restore_best_weights=True,
            )
        ],
    )

    verifier.save(CANDIDATE_PATH)
    test_labels = np.concatenate([labels.numpy().astype(int) for _images, labels in test_data])
    not_cassava_probability = verifier.predict(
        test_data.map(lambda images, _labels: images),
        verbose=1,
    ).reshape(-1)
    cassava_confidence = 1.0 - not_cassava_probability
    predicted_not_cassava = cassava_confidence < MIN_CASSAVA_CONFIDENCE
    report = classification_report(
        test_labels,
        predicted_not_cassava.astype(int),
        labels=[0, 1],
        target_names=["cassava", "not_cassava"],
        output_dict=True,
        zero_division=0,
    )
    false_acceptances = int(np.sum((test_labels == 1) & ~predicted_not_cassava))
    non_cassava_count = int(np.sum(test_labels == 1))
    results = {
        "class_order": ["cassava", "not_cassava"],
        "cassava_acceptance_threshold": MIN_CASSAVA_CONFIDENCE,
        "test_image_count": int(len(test_labels)),
        "confusion_matrix": confusion_matrix(
            test_labels,
            predicted_not_cassava.astype(int),
            labels=[0, 1],
        ).tolist(),
        "classification_report": report,
        "non_cassava_false_acceptances": false_acceptances,
        "non_cassava_false_acceptance_rate": (
            false_acceptances / non_cassava_count if non_cassava_count else None
        ),
    }
    REPORT_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("Held-out test report:")
    print(json.dumps(results, indent=2))
    print(f"Candidate verifier saved to: {CANDIDATE_PATH}")
    print(f"Test report saved to: {REPORT_PATH}")
    print("Do not deploy the candidate until its false-acceptance rate is reviewed.")


if __name__ == "__main__":
    tf.keras.utils.set_random_seed(SEED)
    main()
