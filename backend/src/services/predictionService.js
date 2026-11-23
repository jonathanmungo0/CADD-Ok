
const AI_SERVICE_URL = process.env.AI_SERVICE_URL;

if (!AI_SERVICE_URL) {
  throw new Error('AI_SERVICE_URL is not configured in backend/.env');
}

const AI_BASE_URL = AI_SERVICE_URL.replace(/\/+$/, '');

export async function predictCassavaDisease(file) {
  if (!file?.buffer || !file?.mimetype || !file?.originalname) {
    throw new Error('A valid cassava leaf image is required.');
  }

  const form = new FormData();

  const imageBlob = new Blob(
    [file.buffer],
    { type: file.mimetype }
  );

  form.append('file', imageBlob, file.originalname);

  const response = await fetch(`${AI_BASE_URL}/predict`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000)
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {
      detail: 'The AI service returned an invalid JSON response.'
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}
