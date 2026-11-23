
import io
import json
import logging
import os
from pathlib import Path

import numpy as np
import tensorflow as tf

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input



# ---------------------------------------
# 1. Application and file paths
# ---------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cadd-ai")

app = FastAPI(
    title="CADD-System AI Service",
    description="Cassava leaf disease classification API",
    version="1.0.0",
)

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = Path(os.getenv("CADD_MODEL_PATH", BASE_DIR / "models" / "cassava_model.keras")).resolve()
CLASS_NAMES_PATH = Path(os.getenv("CADD_CLASS_NAMES_PATH", BASE_DIR / "models" / "class_names.json")).resolve()
VERIFIER_MODEL_PATH = Path(os.getenv("CADD_VERIFIER_MODEL_PATH", BASE_DIR / "models" / "cassava_verifier.keras")).resolve()
MIN_CONFIDENCE = float(os.getenv("CADD_MIN_CONFIDENCE", "0.60"))
MIN_CASSAVA_CONFIDENCE = float(os.getenv("CADD_MIN_CASSAVA_CONFIDENCE", "0.99"))
ALLOW_UNVERIFIED_PREDICTIONS = os.getenv(
    "CADD_ALLOW_UNVERIFIED_PREDICTIONS",
    "false",
).strip().lower() in {"1", "true", "yes", "on"}

IMAGE_SIZE = (224, 224)
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

model = None
class_names = None
verifier_model = None

if not 0 <= MIN_CONFIDENCE <= 1:
    raise ValueError("CADD_MIN_CONFIDENCE must be between 0 and 1.")
if not 0 <= MIN_CASSAVA_CONFIDENCE <= 1:
    raise ValueError("CADD_MIN_CASSAVA_CONFIDENCE must be between 0 and 1.")

# ---------------------------------------
# 2. Load model and class mapping
# ---------------------------------------

@app.on_event("startup")
def load_model():
    global model, class_names, verifier_model

    try:
        if not MODEL_PATH.is_file():
            raise FileNotFoundError(
                f"Trained model not found: {MODEL_PATH}"
            )

        if not CLASS_NAMES_PATH.is_file():
            raise FileNotFoundError(
                f"Class mapping not found: {CLASS_NAMES_PATH}"
            )

        loaded_model = tf.keras.models.load_model(MODEL_PATH, compile=False)

        with open(CLASS_NAMES_PATH, "r", encoding="utf-8") as file:
            loaded_classes = json.load(file)

        # Convert JSON keys to integers.
        loaded_classes = {
            int(key): str(value)
            for key, value in loaded_classes.items()
        }

        expected_classes = ["cbb", "cbsd", "cgm", "cmd", "healthy"]
        if set(loaded_classes) != set(range(len(loaded_classes))):
            raise ValueError("Class mapping keys must be contiguous and start at zero.")
        if [loaded_classes[i] for i in range(5)] != expected_classes:
            raise ValueError("The first five model outputs must map to cbb, cbsd, cgm, cmd, and healthy in that order.")
        if len(loaded_classes) == 6 and loaded_classes[5] != "not_cassava":
            raise ValueError("The optional sixth model output must be not_cassava.")
        if len(loaded_classes) not in {5, 6}:
            raise ValueError("Expected five cassava classes and an optional sixth not_cassava class.")

        output_classes = loaded_model.output_shape[-1]

        if output_classes != len(loaded_classes):
            raise ValueError(
                f"Model outputs {output_classes} classes, but "
                f"class_names.json contains {len(loaded_classes)}."
            )



        model = loaded_model
        class_names = loaded_classes

        logger.info("CADD model loaded from %s with %s outputs.", MODEL_PATH, output_classes)

    except Exception:
        model = None
        class_names = None
        logger.exception("Failed to load the CADD model.")

    try:
        if not VERIFIER_MODEL_PATH.is_file():
            raise FileNotFoundError(
                f"Cassava verifier not found: {VERIFIER_MODEL_PATH}. "
                "Train it with labeled cassava and non-cassava images before enabling predictions."
            )

        loaded_verifier = tf.keras.models.load_model(VERIFIER_MODEL_PATH, compile=False)
        if loaded_verifier.output_shape[-1] != 1:
            raise ValueError(
                "Cassava verifier must have one sigmoid output for the not_cassava probability."
            )
        verifier_model = loaded_verifier
        logger.info("Cassava verifier loaded from %s.", VERIFIER_MODEL_PATH)
    except Exception as exc:
        verifier_model = None
        if ALLOW_UNVERIFIED_PREDICTIONS:
            logger.warning(
                "Cassava verifier is unavailable; disease-only fallback is enabled: %s",
                exc,
            )
        else:
            logger.exception("Failed to load the cassava verifier.")

# ---------------------------------------
# 3. Health endpoint
# ---------------------------------------

@app.get("/health")
def health():
    return {
        "service": "CADD-System AI",
        "model_loaded": model is not None,
        "model_file": MODEL_PATH.name,
        "verifier_loaded": verifier_model is not None,
        "verifier_file": VERIFIER_MODEL_PATH.name,
        "allow_unverified_predictions": ALLOW_UNVERIFIED_PREDICTIONS,
        "prediction_mode": (
            "cassava_verified"
            if verifier_model is not None
            else "disease_only_unverified"
            if ALLOW_UNVERIFIED_PREDICTIONS
            else "blocked"
        ),
        "minimum_cassava_confidence": MIN_CASSAVA_CONFIDENCE,
        "tensorflow_version": tf.__version__,
        "classes_loaded": class_names is not None,
        "classes": list(class_names.values()) if class_names else [],
        "minimum_confidence": MIN_CONFIDENCE,
        "has_non_cassava_class": bool(class_names and "not_cassava" in class_names.values()),
    }


# ---------------------------------------
# 4. Preprocess the uploaded image
# ---------------------------------------

def prepare_image(image_bytes: bytes):
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            image = source.convert("RGB")
            image = image.resize(IMAGE_SIZE)

            image_array = np.asarray(
                image,
                dtype=np.float32,
            )

    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid image.",
        ) from exc

    # Must match the preprocessing used during training.
    image_array = preprocess_input(image_array)

    # (224, 224, 3) becomes (1, 224, 224, 3).
    image_array = np.expand_dims(image_array, axis=0)

    return image_array


# ---------------------------------------
# 5. Prediction endpoint
# ---------------------------------------

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    if model is None or class_names is None:
        raise HTTPException(
            status_code=503,
            detail="AI model is not ready. Check /health.",
        )
    if verifier_model is None and not ALLOW_UNVERIFIED_PREDICTIONS:
        raise HTTPException(
            status_code=503,
            detail=(
                "Cassava verification is not ready. Train and install "
                "models/cassava_verifier.keras before accepting images."
            ),
        )

    allowed_types = {"image/jpeg", "image/png", "image/webp"}

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=415,
            detail="Upload a JPEG, PNG, or WebP image.",
        )

    image_bytes = await file.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="The uploaded image is empty.",
        )

    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Image is too large. Maximum size is 10 MB.",
        )

    image_array = prepare_image(image_bytes)
    verification_status = "verified" if verifier_model is not None else "skipped"
    cassava_confidence = None

    try:
        if verifier_model is not None:
            not_cassava_scores = np.asarray(
                verifier_model.predict(image_array, verbose=0),
                dtype=np.float32,
            ).reshape(-1)
            if len(not_cassava_scores) != 1 or not np.isfinite(not_cassava_scores[0]):
                raise ValueError("Cassava verifier returned an invalid score.")
            not_cassava_probability = float(not_cassava_scores[0])
            if not 0 <= not_cassava_probability <= 1:
                raise ValueError("Cassava verifier output is outside the probability range.")

            cassava_confidence = 1.0 - not_cassava_probability
            if cassava_confidence < MIN_CASSAVA_CONFIDENCE:
                reason = "not_cassava" if cassava_confidence < 0.5 else "uncertain_verification"
                return {
                    "status": "rejected",
                    "reason": reason,
                    "cassava_confidence": cassava_confidence,
                    "verification_status": verification_status,
                    "verification_threshold": MIN_CASSAVA_CONFIDENCE,
                    "model_version": MODEL_PATH.name,
                    "verifier_version": VERIFIER_MODEL_PATH.name,
                }

        # Model returns one probability per class.
        scores = np.asarray(model.predict(image_array, verbose=0)[0], dtype=np.float32)

        if len(scores) != len(class_names) or not np.all(np.isfinite(scores)):
            raise ValueError("Model returned invalid class scores.")
        if np.any(scores < 0) or np.any(scores > 1):
            raise ValueError("Model output is not a probability distribution.")

        predicted_index = int(np.argmax(scores))
        confidence = float(scores[predicted_index])
        predicted_class = class_names[predicted_index]

        all_scores = {
            class_names[i]: float(scores[i])
            for i in range(len(scores))
        }

        if predicted_class == "not_cassava":
            return {
                "status": "rejected",
                "reason": "not_cassava",
                "confidence": confidence,
                "all_scores": all_scores,
                "model_version": MODEL_PATH.name,
                "cassava_confidence": cassava_confidence,
                "verification_status": verification_status,
                "verifier_version": VERIFIER_MODEL_PATH.name if verifier_model is not None else None,
            }

        if confidence < MIN_CONFIDENCE:
            return {
                "status": "rejected",
                "reason": "low_confidence",
                "confidence": confidence,
                "all_scores": all_scores,
                "model_version": MODEL_PATH.name,
                "cassava_confidence": cassava_confidence,
                "verification_status": verification_status,
                "verifier_version": VERIFIER_MODEL_PATH.name if verifier_model is not None else None,
            }

        return {
            "status": "accepted",
            "predicted_class": predicted_class,
            "confidence": confidence,
            "all_scores": all_scores,
            "model_version": MODEL_PATH.name,
            "cassava_confidence": cassava_confidence,
            "verification_status": verification_status,
            "verifier_version": VERIFIER_MODEL_PATH.name if verifier_model is not None else None,
        }

    except Exception as exc:
        logger.exception("Prediction failed.")
        raise HTTPException(
            status_code=500,
            detail="The AI service could not classify this image.",
        ) from exc
