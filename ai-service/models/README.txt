The active model is cassava_model.keras. It must output these classes in order:
cbb, cbsd, cgm, cmd, healthy.

To reject known non-cassava images, retrain with varied examples in
ai-service/dataset/non_cassava/. The training script writes a six-class
cassava_model_candidate.keras and class_names_candidate.json without replacing
the active files. Configure CADD_MODEL_PATH and CADD_CLASS_NAMES_PATH to test a
candidate. Preprocessing in app.py must match the preprocessing used for
training.