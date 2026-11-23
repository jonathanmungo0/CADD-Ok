import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import train_verifier


class VerifierTrainingDataTests(unittest.TestCase):
    def test_collects_images_from_every_non_cassava_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sources = (
                root / "not_cassava",
                root / "verifier" / "not_leaf",
                root / "verifier" / "other_plant_leaf",
            )
            for index, source in enumerate(sources):
                source.mkdir(parents=True)
                (source / f"sample-{index}.jpg").touch()

            with (
                patch.object(train_verifier, "NON_CASSAVA_DIR", sources[0]),
                patch.object(train_verifier, "LEGACY_DATA_DIR", root / "verifier"),
            ):
                images = train_verifier.non_cassava_training_images()

        self.assertEqual(
            {path.name for path in images},
            {"sample-0.jpg", "sample-1.jpg", "sample-2.jpg"},
        )

    def test_preserves_existing_train_validation_and_test_folders(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = []
            for split in ("train", "val", "test"):
                for label in (0, 1):
                    image = root / split / f"class-{label}" / f"{split}-{label}.jpg"
                    image.parent.mkdir(parents=True, exist_ok=True)
                    image.touch()
                    rows.append({"path": str(image), "label": label})

            train, validation, test = train_verifier.split_image_frame(
                pd.DataFrame(rows)
            )

        self.assertTrue(all(Path(path).parts[-3] == "train" for path in train["path"]))
        self.assertTrue(all(Path(path).parts[-3] == "val" for path in validation["path"]))
        self.assertTrue(all(Path(path).parts[-3] == "test" for path in test["path"]))

    def test_stratifies_unpartitioned_images_without_overlap(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [
                {"path": str(root / f"class-{label}" / f"image-{index}.jpg"), "label": label}
                for label in (0, 1)
                for index in range(20)
            ]
            train, validation, test = train_verifier.split_image_frame(pd.DataFrame(rows))

        self.assertEqual(set(train["label"]), {0, 1})
        self.assertEqual(set(validation["label"]), {0, 1})
        self.assertEqual(set(test["label"]), {0, 1})
        self.assertFalse(set(train["path"]) & set(validation["path"]))
        self.assertFalse(set(train["path"]) & set(test["path"]))
        self.assertFalse(set(validation["path"]) & set(test["path"]))


if __name__ == "__main__":
    unittest.main()
