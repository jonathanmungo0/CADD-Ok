import os
from pathlib import Path

import numpy as np
import tensorflow as tf
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

MODEL_PATH = Path(os.getenv(
    "CADD_VERIFIER_MODEL_PATH",
    Path(__file__).resolve().parent / "models" / "cassava_verifier.keras",
)).resolve()

verifier = tf.keras.models.load_model(MODEL_PATH, compile=False)

CASSAVA_THRESHOLD = float(os.getenv("CADD_MIN_CASSAVA_CONFIDENCE", "0.99"))
if not 0 <= CASSAVA_THRESHOLD <= 1:
    raise ValueError("CADD_MIN_CASSAVA_CONFIDENCE must be between 0 and 1.")


def verify_cassava(image):
    image = image.convert("RGB")
    image = image.resize((224, 224))

    image_array = np.array(image, dtype=np.float32)

    image_array = preprocess_input(image_array)

    image_array = np.expand_dims(image_array, axis=0)

    predictions = np.asarray(verifier.predict(image_array, verbose=0)).reshape(-1)
    if len(predictions) != 1 or not np.isfinite(predictions[0]):
        raise ValueError("Cassava verifier returned an invalid score.")

    cassava_probability = 1.0 - float(predictions[0])
    if not 0 <= cassava_probability <= 1:
        raise ValueError("Cassava verifier output is outside the probability range.")

    if cassava_probability < CASSAVA_THRESHOLD:
        reason = "not_cassava" if cassava_probability < 0.5 else "uncertain_verification"
        return {
            "valid": False,
            "message": (
                "This image does not appear to contain "
                "a cassava leaf. Please upload a clear "
                "cassava leaf photograph."
            ),
            "detected_class": reason,
            "cassava_confidence": cassava_probability
        }

    return {
        "valid": True,
        "message": "Cassava leaf verified.",
        "cassava_confidence": cassava_probability
    }