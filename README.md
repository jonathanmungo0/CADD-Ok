# CADD-System — Cassava Disease Detection

A cassava-only application using React + Vite, Node.js/Express, PostgreSQL (`cassavad_db`), and a TensorFlow inference service.

## Requirements
- Node.js 20+
- PostgreSQL 15+
- Python 3.10–3.12 for the AI service and model training (`tensorflow==2.18.0`)
- The trained models are included under `ai-service/models/`. Raw training and evaluation image datasets are kept out of Git because of their size; obtain suitable data separately if you plan to train or evaluate models.

## 1. Database
Create the database and run the schema:

```sql
CREATE DATABASE cassavad_db;
```

Then from the project root (PowerShell or Command Prompt):
```bash
psql -U postgres -d cassavad_db -f database/schema.sql
```
The schema creates the `users`, `farmers`, `predictions`, and `system_activity` tables. Re-running it adds account-link columns to an existing installation without removing existing farmer or prediction records.

## 2. Backend
```bash
cd backend
copy .env.example .env
npm install
npm run dev
```
Edit `backend/.env` and set `DATABASE_URL` to your PostgreSQL connection string, for example `postgresql://postgres:YOUR_PASSWORD@localhost:5432/cassavad_db`. The API listens on port 4000 and calls FastAPI at `http://127.0.0.1:8000` by default. Keep `FRONTEND_ORIGIN=http://localhost:5173` for local development.

## 3. Frontend
In a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`. The frontend API address is configured in `frontend/.env` as `VITE_API_URL=http://localhost:4000`.

For access from another device on the same network, set `VITE_API_URL` in `frontend/.env` to `http://<server-lan-ip>:4000` and `FRONTEND_ORIGIN` in `backend/.env` to `http://<device-origin>:5173` (usually `http://<server-lan-ip>:5173`), then restart both services. Do not include an extra `http://` in either URL.

## Farmer and administrator accounts
1. Apply `database/schema.sql` before starting the API.
2. Set `AUTH_SECRET` in `backend/.env` to a long, random value and keep it private.
3. Farmers register from the sign-in page with their name, email, phone, password, and optional farm details. Registration always creates a farmer account; users cannot grant themselves administrator access.
4. Configure `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 10 characters), and optionally `ADMIN_FULL_NAME` in `backend/.env`, then run `npm run admin:bootstrap` from `backend` to provision the administrator. Remove the bootstrap password from the environment after setup. To reset a user's password later, use **Reset password** in the administrator dashboard.
5. Sign in with email or phone. Farmers are sent to their personal dashboard; administrators are sent to the system dashboard.

The farmer dashboard supports camera capture/image upload, AI predictions with confidence and recommendations, private prediction history, cassava assistant chat, and profile/farm updates. The administrator dashboard reports farmer/prediction totals, disease statistics, all-user prediction history, account and farm management, recent activity, and database/AI service health. This project has no IoT sensor integration, so sensor-device management is not available.

Password recovery is handled by contacting the system administrator; this project has no email delivery service. Public registration cannot create administrator accounts.

## 4. AI service
```bash
cd ai-service
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```
Start the service from `ai-service` with `uvicorn app:app --reload --port 8000`. Check `http://127.0.0.1:8000/health` or the frontend status badge to verify that the model loaded.

## Cassava leaf verification
The existing `models/cassava_model.keras` is the five-class disease classifier. A valid `models/cassava_verifier.keras` must verify the plant before disease classification; images below `CADD_MIN_CASSAVA_CONFIDENCE` (default `0.99`) are rejected. This conservative threshold can reject some valid cassava photos; lower it only after evaluating a newly trained verifier on independent local cassava and other-plant images. If verifier weights are missing or fail to load, predictions are blocked by default. Only explicitly set `CADD_ALLOW_UNVERIFIED_PREDICTIONS=true` for a temporary, clearly unverified fallback; unrelated plants can receive cassava labels in that mode.

Prepare verifier data in this layout:
```text
ai-service/data/cassava_verification/
├── cassava/       # optional; otherwise uses the labeled images in dataset/train.csv
└── not_cassava/   # required: other plant species and unsuitable/non-leaf images
```
Use representative, varied images from multiple plant species, backgrounds, lighting, and cameras. The training script also includes the existing `dataset/verifier/cassava_leaf`, `other_plant_leaf`, and `not_leaf` folders. It requires at least 100 images in each class, preserves existing train/validation/test folders, and makes stratified splits for unpartitioned images. It reports held-out false acceptance of non-cassava images. Run `python train_verifier.py` from `ai-service`. It saves a candidate to `models/cassava_verifier_candidate.keras` and a test report to `models/cassava_verifier_test_report.json`; it does not overwrite or automatically activate the verifier. Review the report and test independent images, then copy the approved candidate to `models/cassava_verifier.keras` and restart the AI service. Do not treat the minimum image count or the existing verifier report as evidence that the currently installed model generalizes; its previous training setup omitted the existing other-plant leaf folder. An installed verifier automatically restores verified two-model mode.

## Model, data, and accuracy
- Inference loads `ai-service/models/cassava_model.keras` and uses its learned weights. The CSV and image dataset are used during training, not looked up for each uploaded image; that is the normal model-inference flow.
- The included training set has 21,397 labeled cassava images across five classes. It contains no labeled non-cassava examples, so the existing model cannot reliably identify arbitrary plants as “not cassava.”
- A 600-image balanced sample from the script's fixed 20% validation split scored 54% accuracy for the current model. At a 0.90 confidence cutoff, it accepted 14% of that sample and was correct on 82% of accepted images. This is a sampled evaluation, not a production accuracy guarantee.
- The service now uses a configurable confidence cutoff, defaulting to 0.60 (`CADD_MIN_CONFIDENCE`). In the same sample, 0.60 accepted 60% of images and was correct on 63% of accepted images. This trades more results for lower reliability; the score is not a calibrated probability or accuracy guarantee.
- When a score is below the cutoff, the frontend now shows the top three model matches as possibilities, not a confirmed diagnosis, instead of only showing a generic retry message.
- To train a real rejection class, add at least 100 varied JPG/JPEG/PNG non-cassava examples under `ai-service/dataset/non_cassava/`. Include other crops and plants, as well as non-leaf/irrelevant images; a narrow set of lookalikes will not cover all out-of-scope inputs.
- Install the AI requirements in a Python 3.10–3.12 environment, then run `python train_model.py` from `ai-service`. Training fine-tunes the MobileNetV2 backbone and prints a held-out confusion matrix and per-class report. It writes `models/cassava_model_candidate.keras` and `models/class_names_candidate.json` and does not replace the active model.
- Test the candidate by setting `CADD_MODEL_PATH` and `CADD_CLASS_NAMES_PATH` to those candidate files before starting the AI service. In Windows PowerShell, set them to the full paths of the two files under `ai-service/models/`. Promote the candidate only after checking its validation report and testing unrelated plant images.
- The model labels and order must match its output: CBB, CBSD, CGM, CMD, healthy, and optionally `not_cassava`.

## Important
- This is decision support, not a validated diagnostic product. Confirm uncertain or severe cases with a Rwanda agricultural extension officer.
- Image-based classification cannot guarantee a diagnosis. Do not apply pesticide or remove crops solely based on this result.
- Ensure model training and serving use the same TensorFlow version; the AI health endpoint reports the version currently running.
- The cassava chat endpoint provides a small set of rule-based cultivation guidance, rejects unrelated crop topics, and does not send chat messages to an external AI provider or save them in PostgreSQL. It is not a general-purpose generative AI model.
- The chat API accepts `POST /api/chat` with `{"message":"When should I plant cassava?"}` and returns a cassava-only answer or a clear out-of-scope response.
- Replace `frontend/public/logo.svg` and `frontend/public/images/cassava-placeholder.svg` with your own assets, retaining the filenames.


## Troubleshooting: browser says "Failed to fetch"
1. Start the backend in its own terminal: `cd backend` then `npm run dev`.
2. Open `http://localhost:4000/api/health`. If this page does not load, the backend is not reachable; check the terminal and port 4000.
3. Start the frontend in another terminal: `cd frontend` then `npm run dev`.
4. If Vite uses another port or a different LAN IP, update `FRONTEND_ORIGIN` in `backend/.env` to the exact frontend origin (for example, `http://<server-lan-ip>:5173`).
5. If the health endpoint loads but reports database unavailable, check `DATABASE_URL` in `backend/.env` and ensure PostgreSQL is running with database `cassavad_db`.
6. If prediction returns an AI-service error, open `http://localhost:4000/api/health` and check `ai_service`. Restart the AI service after changing model paths or thresholds; the API does not invent a result when the model is unavailable.
7. Ask only cassava-cultivation questions in the chatbox. It currently answers supported topics from built-in guidance; unsupported questions are declined.
8. For prediction readiness, confirm both `model_loaded: true` and `verifier_loaded: true` at the AI `/health` endpoint.
