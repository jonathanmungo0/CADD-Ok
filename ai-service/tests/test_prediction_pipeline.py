import asyncio
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException
from PIL import Image

import app as ai_service


class FakeModel:
    def __init__(self, scores, output_shape):
        self.scores = np.asarray(scores, dtype=np.float32)
        self.output_shape = output_shape
        self.calls = 0

    def predict(self, _image, verbose=0):
        self.calls += 1
        return self.scores


class FakeUpload:
    content_type = "image/png"

    def __init__(self):
        image = Image.new("RGB", (224, 224), color=(40, 150, 70))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        self.image_bytes = buffer.getvalue()

    async def read(self):
        return self.image_bytes


class PredictionPipelineTests(unittest.TestCase):
    def run_prediction(self, verifier, classifier):
        with (
            patch.object(ai_service, "verifier_model", verifier),
            patch.object(ai_service, "model", classifier),
            patch.object(ai_service, "class_names", {
                0: "cbb",
                1: "cbsd",
                2: "cgm",
                3: "cmd",
                4: "healthy",
            }),
        ):
            return asyncio.run(ai_service.predict(FakeUpload()))

    def test_non_cassava_is_rejected_before_disease_model(self):
        verifier = FakeModel([[0.95]], (None, 1))
        classifier = FakeModel([[0.1, 0.1, 0.1, 0.1, 0.6]], (None, 5))
        result = self.run_prediction(verifier, classifier)
        self.assertEqual(result["reason"], "not_cassava")
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(classifier.calls, 0)

    def test_uncertain_verification_is_rejected_before_disease_model(self):
        verifier = FakeModel([[0.35]], (None, 1))
        classifier = FakeModel([[0.1, 0.1, 0.1, 0.1, 0.6]], (None, 5))
        result = self.run_prediction(verifier, classifier)
        self.assertEqual(result["reason"], "uncertain_verification")
        self.assertEqual(classifier.calls, 0)

    def test_stricter_verification_rejects_other_plant_score_before_disease_model(self):
        verifier = FakeModel([[0.02]], (None, 1))
        classifier = FakeModel([[0.05, 0.1, 0.05, 0.7, 0.1]], (None, 5))
        with patch.object(ai_service, "MIN_CASSAVA_CONFIDENCE", 0.99):
            result = self.run_prediction(verifier, classifier)
        self.assertEqual(result["reason"], "uncertain_verification")
        self.assertEqual(classifier.calls, 0)

    def test_verified_cassava_reaches_existing_disease_model(self):
        verifier = FakeModel([[0.005]], (None, 1))
        classifier = FakeModel([[0.05, 0.1, 0.05, 0.7, 0.1]], (None, 5))
        result = self.run_prediction(verifier, classifier)
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["predicted_class"], "cmd")
        self.assertAlmostEqual(result["cassava_confidence"], 0.995, places=5)
        self.assertEqual(classifier.calls, 1)

    def test_missing_verifier_fails_closed(self):
        with (
            patch.object(ai_service, "verifier_model", None),
            patch.object(ai_service, "ALLOW_UNVERIFIED_PREDICTIONS", False),
        ):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(ai_service.predict(FakeUpload()))
        self.assertEqual(error.exception.status_code, 503)

    def test_unverified_fallback_is_disabled_by_default(self):
        self.assertFalse(ai_service.ALLOW_UNVERIFIED_PREDICTIONS)

    def test_missing_verifier_runs_disease_model_in_fallback_mode(self):
        classifier = FakeModel([[0.05, 0.1, 0.05, 0.7, 0.1]], (None, 5))
        with tempfile.TemporaryDirectory() as directory:
            broken_verifier = Path(directory) / "cassava_verifier.keras"
            broken_verifier.touch()
            with (
                patch.object(ai_service, "ALLOW_UNVERIFIED_PREDICTIONS", True),
                patch.object(ai_service, "VERIFIER_MODEL_PATH", broken_verifier),
            ):
                result = self.run_prediction(None, classifier)
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(result["predicted_class"], "cmd")
        self.assertEqual(result["verification_status"], "skipped")
        self.assertIsNone(result["cassava_confidence"])
        self.assertEqual(classifier.calls, 1)

    def test_unavailable_verifier_is_reported_as_unverified_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            broken_verifier = Path(directory) / "cassava_verifier.keras"
            broken_verifier.touch()
            with (
                patch.object(ai_service, "ALLOW_UNVERIFIED_PREDICTIONS", True),
                patch.object(ai_service, "VERIFIER_MODEL_PATH", broken_verifier),
                patch.object(ai_service, "verifier_model", None),
            ):
                status = ai_service.health()
        self.assertEqual(status["prediction_mode"], "disease_only_unverified")
        self.assertFalse(status["verifier_loaded"])


if __name__ == "__main__":
    unittest.main()
