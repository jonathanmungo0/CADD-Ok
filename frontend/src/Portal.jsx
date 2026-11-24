import React, { useEffect, useRef, useState } from 'react';
import './portal.css';
import './portal-admin.css';

const API = (import.meta.env.VITE_API_URL || 'http://localhost:4000')
  .trim()
  .replace(/\/$/, '');
const TOKEN_KEY = 'cadd-auth-token';

async function request(path, token, options = {}) {
  const headers = { ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, { ...options, headers });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.code = data.code;
    error.candidates = data.candidates;
    throw error;
  }
  return data;
}

function Portal() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));
  const [startupError, setStartupError] = useState('');

  useEffect(() => {
    if (!token) return;
    request('/api/auth/me', token)
      .then(data => setUser(data.user))
      .catch(error => {
        setStartupError(error.message);
        localStorage.removeItem(TOKEN_KEY);
        setToken('');
      })
      .finally(() => setChecking(false));
  }, []);

  function signIn(data) {
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
    setStartupError('');
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setUser(null);
  }

  if (checking) return <main className="portal-loading"><span className="loading-mark">✿</span><p>Opening your CADD-System dashboard…</p></main>;
  if (!user || !token) {
    return <AuthScreen onAuth={signIn} initialMessage={startupError} />;
  }
  if (user.role === 'administrator') {
    return <AdminDashboard user={user} token={token} onSignOut={signOut} />;
  }
  return <FarmerDashboard user={user} token={token} onUserChange={setUser} onSignOut={signOut} />;
}

function AuthScreen({ onAuth, initialMessage }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', password: '', confirm_password: '',
    farm_name: '', farm_location: '', preferred_language: 'en'
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState(initialMessage || '');
  const [busy, setBusy] = useState(false);

  function update(event) {
    setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (mode === 'register' && form.password !== form.confirm_password) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const body = mode === 'login'
        ? { identifier: form.email, password: form.password }
        : {
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          password: form.password,
          farm_name: form.farm_name,
          farm_location: form.farm_location,
          preferred_language: form.preferred_language
        };
      const data = await request(`/api/auth/${mode}`, '', { method: 'POST', body: JSON.stringify(body) });
      onAuth(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <header className="auth-brand">
      <img src="/CADD LGO2.jpg" alt="" />
      <div><strong>CADD-System</strong><span>Cassava Disease Detection</span></div>
    </header>
    <section className="auth-card">
      <p className="eyebrow">SMART FARMING · RWANDA</p>
      <h1>{mode === 'login' ? 'Welcome back' : 'Create your farmer account'}</h1>
      <p className="auth-intro">{mode === 'login'
        ? 'Sign in to access your cassava predictions and farm dashboard.'
        : 'Create an account to save your cassava analyses and farm details.'}</p>
      {message && <div className="auth-notice" role="status">{message}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <form className="auth-form" onSubmit={submit}>
        {mode === 'register' && <>
          <label>Full name<input name="full_name" value={form.full_name} onChange={update} required maxLength="200" autoComplete="name" /></label>
          <div className="auth-form-row">
            <label>Email<input name="email" type="email" value={form.email} onChange={update} required maxLength="254" autoComplete="email" /></label>
            <label>Phone number<input name="phone" type="tel" value={form.phone} onChange={update} required maxLength="50" autoComplete="tel" /></label>
          </div>
          <div className="auth-form-row">
            <label>Farm name <span>(optional)</span><input name="farm_name" value={form.farm_name} onChange={update} maxLength="200" /></label>
            <label>Farm location <span>(optional)</span><input name="farm_location" value={form.farm_location} onChange={update} maxLength="200" /></label>
          </div>
          <label>Preferred language<select name="preferred_language" value={form.preferred_language} onChange={update}>
            <option value="en">English</option><option value="rw">Kinyarwanda</option><option value="fr">French</option>
          </select></label>
          <div className="role-note"><strong>Account type</strong><span>Farmer · Administrator accounts are provisioned by the system owner.</span></div>
        </>}
        {mode === 'login' && <label>Email or phone number<input name="email" value={form.email} onChange={update} required autoComplete="username" /></label>}
        <label>Password<input name="password" type="password" value={form.password} onChange={update} required minLength={mode === 'register' ? 10 : undefined} maxLength="128" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {mode === 'register' && <label>Confirm password<input name="confirm_password" type="password" value={form.confirm_password} onChange={update} required minLength="10" maxLength="128" autoComplete="new-password" /></label>}
        <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create farmer account'}</button>
      </form>
      {mode === 'login' && <p className="forgot-note">Forgot your password?{' '}
        <button type="button" className="link-button" onClick={() => setMessage('Contact your system administrator to reset your password. Email-based recovery is not configured.')}>Reset password</button>
      </p>}
      <p className="auth-switch">{mode === 'login' ? 'New to CADD-System?' : 'Already registered?'}{' '}
        <button type="button" className="link-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage(''); }}>
          {mode === 'login' ? 'Create a farmer account' : 'Sign in'}
        </button>
      </p>
    </section>
    <p className="auth-footnote"> Developped by @Jonathan MUNGO & @UMUHOZAWASE Pascaline</p>
  </main>;
}

function DashboardHeader({ user, status, onSignOut }) {
  return <header className="dash-header">
    <a className="dash-brand" href="#" aria-label="CADD-System dashboard">
      <img src="/CADD LGO2.jpg" alt="" /><span><strong>CADD-System</strong><small>Cassava Disease Detection</small></span>
    </a>
    <div className="dash-header-right">
      {status && <span className={`service-status ${status.database === 'connected' && status.ai_service?.status === 'ready' ? 'service-ready' : ''}`}>
        {status.ai_service?.status === 'ready' ? 'AI service ready' : status.ai_service?.status === 'degraded' ? 'AI service degraded' : 'AI service unavailable'}
      </span>}
      <div className="dash-account"><span>{user.full_name}<small>{user.role === 'administrator' ? 'Administrator' : 'Farmer'}</small></span><button className="secondary" onClick={onSignOut}>Sign out</button></div>
    </div>
  </header>;
}

function FarmerDashboard({ user, token, onUserChange, onSignOut }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [systemHealth, setSystemHealth] = useState(null);
  // Shared Wokwi IoT development feed
const [iotLatest, setIotLatest] = useState(null);
const [iotHistory, setIotHistory] = useState([]);
const [iotError, setIotError] = useState('');
const [iotLoading, setIotLoading] = useState(true);
const [iotUpdatedAt, setIotUpdatedAt] = useState(null);
  const [error, setError] = useState('');
  const [uncertainCandidates, setUncertainCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', text: 'Hello! Ask me about cassava planting, soil, crop care, pests and diseases, or harvest.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [profile, setProfile] = useState({
    full_name: user.full_name, phone: user.phone || '', farm_name: user.farm_name || '',
    farm_location: user.farm_location || '', preferred_language: user.preferred_language || 'en'
  });
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  async function loadHistory() {
    try { setHistory(await request('/api/predictions', token)); }
    catch (loadError) { setError(loadError.message); }
  }

  useEffect(() => {
    loadHistory();
    request('/api/health', token).then(setSystemHealth).catch(() => setSystemHealth({ ai_service: { status: 'unavailable' } }));
  }, []);  // Load the shared Wokwi sensor feed and refresh every 5 seconds.
useEffect(() => {
  let active = true;
  let inFlight = false;

  async function loadIoTReadings() {
    if (inFlight) return;
    inFlight = true;

    try {
      const [latestResponse, historyResponse] = await Promise.all([
        request('/api/iot/latest', token),
        request('/api/iot/history', token)
      ]);

      if (!active) return;

      setIotLatest(latestResponse.data || null);
      setIotHistory(
        Array.isArray(historyResponse.data) ? historyResponse.data : []
      );
      setIotError('');
      setIotUpdatedAt(new Date());
    } catch (iotRequestError) {
      if (active) setIotError(iotRequestError.message);
    } finally {
      inFlight = false;
      if (active) setIotLoading(false);
    }
  }

  loadIoTReadings();

  const refreshTimer = setInterval(loadIoTReadings, 5000);

  return () => {
    active = false;
    clearInterval(refreshTimer);
  };
}, [token]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

 function chooseImage(nextFile) {
  if (!nextFile) return;

  // Accept JPEG, PNG and WebP images.
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp'
  ];

  if (!allowedTypes.includes(nextFile.type)) {
    setError('Please select a JPG, PNG or WEBP image.');
    return;
  }

  // Maximum image size: 10 MB.
  if (nextFile.size > 10 * 1024 * 1024) {
    setError('Image is too large. Maximum size is 10 MB.');
    return;
  }

  setError('');
  setUncertainCandidates([]);
  setResult(null);

  setFile(nextFile);

  // Display the selected image.
  setPreview(URL.createObjectURL(nextFile));
}

  async function analyze() {
    if (!file) { setError('Take a photo or choose an image of a cassava leaf first.'); return; }
    setBusy(true);
    setError('');
    setUncertainCandidates([]);
    setResult(null);
    try {
      const body = new FormData();
      body.append('image', file);
      const data = await request('/api/predictions', token, { method: 'POST', body });
      setResult(data);
      await loadHistory();
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.code === 'low_confidence') setUncertainCandidates(requestError.candidates || []);
    } finally {
      setBusy(false);
    }
  }

  async function askAssistant(event) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message || chatBusy) return;
    setChatInput('');
    setChatError('');
    setChatMessages(current => [...current, { role: 'user', text: message }]);
    setChatBusy(true);
    try {
      const data = await request('/api/chat', token, { method: 'POST', body: JSON.stringify({ message }) });
      setChatMessages(current => [...current, { role: 'assistant', text: data.answer, disclaimer: data.disclaimer }]);
    } catch (requestError) {
      setChatError(requestError.message);
      setChatMessages(current => current.slice(0, -1));
      setChatInput(message);
    } finally {
      setChatBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError('');
    setProfileMessage('');
    try {
      const data = await request('/api/auth/profile', token, { method: 'PATCH', body: JSON.stringify(profile) });
      onUserChange(data.user);
      setProfileMessage('Your profile and farm information have been saved.');
    } catch (requestError) {
      setProfileError(requestError.message);
    } finally {
      setSavingProfile(false);
    }
  }

  return <main className="dash-shell">
    <DashboardHeader user={user} status={systemHealth} onSignOut={onSignOut} />
    <section className="dash-welcome">
      <div><p className="eyebrow">FARMER DASHBOARD</p><h1>Good day, {user.full_name.split(' ')[0]}.</h1><p>Check a cassava leaf, review your farm records, and get practical crop-care guidance.</p></div>
      <div className="farm-summary"><span>YOUR FARM</span><strong>{user.farm_name || 'Farm details not added'}</strong><small>{user.farm_location || 'Add your farm location in your profile'}</small></div>
    </section>
    <section className="workspace">
      <div className="panel scanner">
        <div className="section-heading"><div><p className="eyebrow">STEP 1</p><h2>Scan a cassava leaf</h2></div><span className="step-icon">01</span></div>
        <p className="muted">Use a well-lit photo with the leaf in focus. Avoid fingers covering the leaf.</p>
        <div className="preview">{preview ? <img src={preview} alt="Selected cassava leaf" /> : <div className="empty-preview"><span className="leaf-icon">✿</span><strong>Your leaf photo appears here</strong><span>JPG, PNG or WEBP · Up to 10 MB</span></div>}</div>
       <div className="actions">

  {/* ANDROID / PHONE CAMERA */}
  <button
    className="secondary"
    type="button"
    onClick={() => cameraRef.current?.click()}
    disabled={busy}
  >
    <span>📷</span> Take photo
  </button>

  {/* PHONE GALLERY OR COMPUTER FILES */}
  <button
    className="secondary"
    type="button"
    onClick={() => galleryRef.current?.click()}
    disabled={busy}
  >
    <span>🖼️</span> Upload image
  </button>

  {/* CAMERA INPUT */}
  <input
    ref={cameraRef}
    type="file"
    accept="image/*"
    capture="environment"
    hidden
    onChange={(event) => {
      chooseImage(event.target.files?.[0]);
      event.target.value = '';
    }}
  />

  {/* GALLERY INPUT */}
  <input
    ref={galleryRef}
    type="file"
    accept="image/jpeg,image/png,image/webp"
    hidden
    onChange={(event) => {
      chooseImage(event.target.files?.[0]);
      event.target.value = '';
    }}
  />

</div>
        {file && <p className="file-name">Selected: {file.name}</p>}
        <button className="primary analyze" type="button" onClick={analyze} disabled={busy}>{busy ? 'Analyzing leaf…' : 'Analyze cassava leaf →'}</button>
        {error && <div className="error" role="alert">{error}</div>}
        {uncertainCandidates.length > 0 && <div className="uncertain-candidates"><strong>Possible model matches only — not a diagnosis</strong><ul>{uncertainCandidates.map(candidate => <li key={candidate.disease_name}>{candidate.disease_name}: {(candidate.model_score * 100).toFixed(1)}% model score</li>)}</ul></div>}
        <p className="privacy-note">{systemHealth?.ai_service?.prediction_mode === 'disease_only_unverified'
          ? 'Plant verification is currently unavailable. The disease model can mislabel non-cassava images; upload cassava leaves only and confirm results with an agricultural extension officer.'
          : 'Image-based predictions are decision support, not a confirmed diagnosis. Ask an agricultural extension officer about uncertain or severe cases.'}</p>
      </div>
      <div className="panel results">
        <div className="section-heading"><div><p className="eyebrow">STEP 2</p><h2>Analysis result</h2></div><span className="step-icon">02</span></div>
        {result ? <PredictionResult result={result} /> : <div className="waiting"><div className="waiting-mark">⌁</div><h3>Your result will appear here</h3><p>After analysis, you will see the predicted condition, confidence score, and recommended next steps.</p></div>}
      </div>
    </section>

        {/* SHARED WOKWI IOT DEVELOPMENT PREVIEW */}
    <section className="panel cadd-iot-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">IOT SENSOR MONITORING</p>
          <h2>Farm environment readings</h2>
        </div>
        <span className="cadd-iot-badge">Wokwi simulation</span>
      </div>

      <div className="cadd-iot-device">
        <span className="cadd-iot-device-dot"></span>
        <div>
          <strong>CADD-WOKWI-ESP32</strong>
          <small>Shared development test device</small>
        </div>
        <span className="cadd-iot-refresh">Refreshes every 5 seconds</span>
      </div>

      {iotError && (
        <div className="error" role="alert">
          Could not load IoT readings: {iotError}
        </div>
      )}

      {iotLoading && !iotLatest ? (
        <p className="muted">Loading sensor readings…</p>
      ) : (
        <>
          <div className="cadd-iot-grid">
            <article className="cadd-iot-card">
              <span>🌡️ Temperature</span>
              <strong>
                {iotLatest?.temperature != null
                  ? `${Number(iotLatest.temperature).toFixed(1)} °C`
                  : '—'}
              </strong>
              <small>Air temperature</small>
            </article>

            <article className="cadd-iot-card">
              <span>💧 Humidity</span>
              <strong>
                {iotLatest?.humidity != null
                  ? `${Number(iotLatest.humidity).toFixed(1)} %`
                  : '—'}
              </strong>
              <small>Relative air humidity</small>
            </article>

            <article className="cadd-iot-card">
              <span>🌱 Soil moisture</span>
              <strong>
                {iotLatest?.soil_moisture != null
                  ? `${Number(iotLatest.soil_moisture).toFixed(1)} %`
                  : '—'}
              </strong>
              <small>Soil moisture level</small>
            </article>
          </div>

          <div className="cadd-iot-meta">
            <span>
              Latest sensor reading:{' '}
              {iotLatest?.received_at
                ? new Date(iotLatest.received_at).toLocaleString()
                : 'No reading received yet'}
            </span>
            <span>
              Dashboard refreshed:{' '}
              {iotUpdatedAt ? iotUpdatedAt.toLocaleTimeString() : '—'}
            </span>
          </div>
        </>
      )}

      <div className="cadd-iot-history">
        <div className="section-heading">
          <div>
            <h3>Recent sensor history</h3>
            <p className="muted">Most recent readings received by CADD-System</p>
          </div>
          <span className="step-icon">{iotHistory.length}</span>
        </div>

        {iotHistory.length > 0 ? (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Temperature</th>
                  <th>Humidity</th>
                  <th>Soil moisture</th>
                </tr>
              </thead>
              <tbody>
                {iotHistory.slice(0, 10).map((reading) => (
                  <tr key={reading.id}>
                    <td>
                      {reading.received_at
                        ? new Date(reading.received_at).toLocaleString()
                        : '—'}
                    </td>
                    <td>
                      {reading.temperature != null
                        ? `${Number(reading.temperature).toFixed(1)} °C`
                        : '—'}
                    </td>
                    <td>
                      {reading.humidity != null
                        ? `${Number(reading.humidity).toFixed(1)} %`
                        : '—'}
                    </td>
                    <td>
                      {reading.soil_moisture != null
                        ? `${Number(reading.soil_moisture).toFixed(1)} %`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No sensor history is available yet.</p>
        )}
      </div>

      <p className="cadd-iot-disclaimer">
        Development preview: these readings come from a shared Wokwi test
        device. They do not represent measurements from your own farm.
      </p>
    </section>


    <section className="panel history-panel">
      <div className="section-heading"><div><p className="eyebrow">YOUR RECORDS</p><h2>Prediction history</h2></div><button className="text-button" onClick={loadHistory}>Refresh ↻</button></div>
      {history.length ? <div className="history-list">{history.map(item => <article className="history-item" key={item.id}><span className="history-leaf">🌱</span><div><strong>{item.disease_name}</strong><small>{new Date(item.created_at).toLocaleString()}</small>{item.recommendations?.length > 0 && <details><summary>View recommendations</summary><ul>{item.recommendations.map((recommendation, index) => <li key={index}>{recommendation}</li>)}</ul></details>}</div><span className="history-confidence">{item.confidence == null ? '—' : `${(Number(item.confidence) * 100).toFixed(1)}%`}</span></article>)}</div> : <p className="muted">Your saved predictions will appear here after your first analysis.</p>}
    </section>
    <section className="farmer-lower-grid">
      <section className="panel chat-panel">
        <div className="section-heading"><div><p className="eyebrow">CASSAVA SUPPORT</p><h2>Ask the cassava assistant</h2></div><span className="step-icon">CA</span></div>
        <p className="muted">Get focused cultivation guidance. Questions stay in this browser session and are not saved to the database.</p>
        <div className="chat-messages" aria-live="polite">{chatMessages.map((message, index) => <div className={`chat-message chat-${message.role}`} key={`${index}-${message.role}`}><strong>{message.role === 'assistant' ? 'Cassava assistant' : 'You'}</strong><p>{message.text}</p>{message.disclaimer && <small>{message.disclaimer}</small>}</div>)}{chatBusy && <div className="chat-message chat-assistant" role="status"><strong>Cassava assistant</strong><p>Preparing cassava guidance…</p></div>}</div>
        {chatError && <div className="error" role="alert">{chatError}</div>}
        <form className="chat-form" onSubmit={askAssistant}><label className="sr-only" htmlFor="cassava-question">Your cassava question</label><input id="cassava-question" value={chatInput} onChange={event => setChatInput(event.target.value)} maxLength="1000" placeholder="e.g. When should I plant cassava?" disabled={chatBusy} /><button className="primary" type="submit" disabled={chatBusy || !chatInput.trim()}>{chatBusy ? 'Sending…' : 'Ask'}</button></form>
      </section>
      <section className="panel profile-panel">
        <div className="section-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h2>Profile & farm</h2></div></div>
        <form className="profile-form" onSubmit={saveProfile}>
          <label>Full name<input value={profile.full_name} onChange={event => setProfile(current => ({ ...current, full_name: event.target.value }))} required maxLength="200" /></label>
          <label>Email<input value={user.email} disabled /></label>
          <label>Phone number<input type="tel" value={profile.phone} onChange={event => setProfile(current => ({ ...current, phone: event.target.value }))} required maxLength="50" /></label>
          <label>Farm name<input value={profile.farm_name} onChange={event => setProfile(current => ({ ...current, farm_name: event.target.value }))} maxLength="200" /></label>
          <label>Farm location<input value={profile.farm_location} onChange={event => setProfile(current => ({ ...current, farm_location: event.target.value }))} maxLength="200" /></label>
          <label>Preferred language<select value={profile.preferred_language} onChange={event => setProfile(current => ({ ...current, preferred_language: event.target.value }))}><option value="en">English</option><option value="rw">Kinyarwanda</option><option value="fr">French</option></select></label>
          <button className="primary" type="submit" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</button>
        </form>
        {profileError && <div className="error" role="alert">{profileError}</div>}
        {profileMessage && <p className="farmer-message" role="status">{profileMessage}</p>}
      </section>
    </section>
    <Footer />
  </main>;
}

function PredictionResult({ result }) {
  return <div className="result-content">
    <div className="status-line"><span className="status-dot"></span> ANALYSIS COMPLETE</div>
    {result.verification_status === 'skipped' && <p className="uncertain-candidates" role="note">Cassava verification was skipped. This is a disease-model prediction only; non-cassava images may be incorrectly labeled.</p>}
    <h3>{result.disease_name}</h3>
    <p className="muted">{result.verification_status === 'skipped' ? 'Unverified plant · cassava disease model only' : 'Cassava · Manihot esculenta'}</p>
    <div className="confidence"><div><span>Model confidence</span><strong>{result.confidence == null ? 'N/A' : `${(result.confidence * 100).toFixed(1)}%`}</strong></div><div className="meter"><span style={{ width: `${Math.max(0, Math.min(100, (result.confidence || 0) * 100))}%` }} /></div></div>
    <h4>Symptoms / notes</h4><p>{result.symptoms}</p>
    <h4>Recommended next steps</h4><ul>{(result.recommendations || []).map((item, index) => <li key={index}>{item}</li>)}</ul>
    <p className="disclaimer">Image-based prediction is not a guarantee. Confirm uncertain or severe cases with an agricultural extension officer.</p>
  </div>;
}

function AdminDashboard({ user, token, onSignOut }) {
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  async function loadDashboard() {
    setError('');
    try {
      const [dashboardData, userData, historyData, healthData] = await Promise.all([
        request('/api/admin/summary', token),
        request('/api/admin/users', token),
        request('/api/predictions', token),
        request('/api/health', token)
      ]);
      setSummary(dashboardData);
      setUsers(userData);
      setPredictions(historyData);
      setHealth(healthData);
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => { loadDashboard(); }, []);

  async function updateUser(account, changes) {
    setBusyId(account.id);
    setError('');
    try {
      await request(`/api/admin/users/${account.id}`, token, { method: 'PATCH', body: JSON.stringify(changes) });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId('');
    }
  }

  return <main className="dash-shell">
    <DashboardHeader user={user} status={health} onSignOut={onSignOut} />
    <section className="dash-welcome admin-welcome">
      <div><p className="eyebrow">ADMINISTRATOR DASHBOARD</p><h1>System overview</h1><p>Monitor farmers, disease predictions, system activity, and AI service health.</p></div>
      <div className="admin-health">
        <span className={`health-dot ${health?.database === 'connected' ? 'health-ok' : ''}`}></span>
        <span><strong>Database</strong><small>{health?.database || 'Checking…'}</small></span>
        <span className={`health-dot ${health?.ai_service?.status === 'ready' ? 'health-ok' : ''}`}></span>
        <span><strong>AI service</strong><small>{health?.ai_service?.status || 'Checking…'}</small></span>
      </div>
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="admin-stat-grid">
      <article className="admin-stat"><span>REGISTERED FARMERS</span><strong>{summary?.total_farmers ?? '—'}</strong><small>Farmer accounts</small></article>
      <article className="admin-stat"><span>TOTAL PREDICTIONS</span><strong>{summary?.total_predictions ?? '—'}</strong><small>Saved disease analyses</small></article>
      <article className="admin-stat"><span>ACTIVE ACCOUNTS</span><strong>{users.filter(account => account.is_active).length}</strong><small>Farmers and administrators</small></article>
      <article className="admin-stat"><span>MODEL STATUS</span><strong className="admin-model-status">{health?.ai_service?.status || '—'}</strong><small>{health?.ai_service?.classes?.length || 0} disease classes</small></article>
    </div>
    <section className="panel admin-panel">
      <div className="section-heading"><div><p className="eyebrow">ACCOUNT MANAGEMENT</p><h2>Registered users & farms</h2></div><button className="text-button" onClick={loadDashboard}>Refresh ↻</button></div>
      {users.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>User</th><th>Role</th><th>Farm & location</th><th>Status</th><th>Account controls</th></tr></thead><tbody>
        {users.map(account => <tr key={account.id}>
          <td><strong>{account.full_name}</strong><small>{account.email}<br />{account.phone || 'No phone number'}</small></td>
          <td><select aria-label={`Role for ${account.full_name}`} value={account.role} disabled={busyId === account.id || account.id === user.id} onChange={event => updateUser(account, { role: event.target.value })}><option value="farmer">Farmer</option><option value="administrator">Administrator</option></select></td>
          <td><FarmEditor account={account} busy={busyId === account.id} onSave={(farmName, farmLocation) => updateUser(account, { farm_name: farmName, farm_location: farmLocation })} /></td>
          <td><span className={`account-status ${account.is_active ? 'account-active' : 'account-disabled'}`}>{account.is_active ? 'Active' : 'Disabled'}</span></td>
          <td><div className="account-controls">
            <button className="secondary" disabled={busyId === account.id || account.id === user.id} onClick={() => updateUser(account, { is_active: !account.is_active })}>{account.is_active ? 'Disable' : 'Enable'}</button>
            <ResetPassword account={account} busy={busyId === account.id} onReset={password => updateUser(account, { password })} />
          </div></td>
        </tr>)}
      </tbody></table></div> : <p className="muted">No user accounts found.</p>}
    </section>
    <section className="admin-lower-grid">
      <section className="panel admin-panel">
        <div className="section-heading"><div><p className="eyebrow">DISEASE MONITORING</p><h2>Prediction statistics</h2></div></div>
        {summary?.disease_statistics?.length ? <div className="disease-stats">{summary.disease_statistics.map(item => {
          const maximum = Math.max(...summary.disease_statistics.map(stat => stat.total), 1);
          return <div className="disease-stat" key={item.disease_name}><div><strong>{item.disease_name}</strong><span>{item.total}</span></div><div className="meter"><span style={{ width: `${(item.total / maximum) * 100}%` }} /></div></div>;
        })}</div> : <p className="muted">No disease predictions have been saved yet.</p>}
      </section>
      <section className="panel admin-panel">
        <div className="section-heading"><div><p className="eyebrow">SYSTEM ACTIVITY</p><h2>Recent events</h2></div></div>
        {summary?.recent_activity?.length ? <div className="activity-list">{summary.recent_activity.map(event => <article className="activity-item" key={event.id}><span className="activity-mark">•</span><div><strong>{event.event_type.replaceAll('_', ' ')}</strong><small>{event.user_name || 'System'} · {new Date(event.created_at).toLocaleString()}</small></div></article>)}</div> : <p className="muted">No recent activity.</p>}
      </section>
    </section>
    <section className="panel admin-panel history-panel">
      <div className="section-heading"><div><p className="eyebrow">ALL USERS</p><h2>Prediction history</h2></div><span className="step-icon">{predictions.length}</span></div>
      {predictions.length ? <div className="history-list">{predictions.map(item => <article className="history-item" key={item.id}><span className="history-leaf">🌱</span><div><strong>{item.disease_name}</strong><small>{item.farmer_name || 'Unassigned'} · {new Date(item.created_at).toLocaleString()}</small></div><span className="history-confidence">{item.confidence == null ? '—' : `${(Number(item.confidence) * 100).toFixed(1)}%`}</span></article>)}</div> : <p className="muted">No prediction history is available.</p>}
    </section>
    <Footer />
  </main>;
}

function ResetPassword({ account, busy, onReset }) {
  const [expanded, setExpanded] = useState(false);
  const [password, setPassword] = useState('');
  if (!expanded) return <button className="text-button reset-link" disabled={busy} onClick={() => setExpanded(true)}>Reset password</button>;
  return <form className="reset-password-form" onSubmit={event => { event.preventDefault(); onReset(password); setPassword(''); setExpanded(false); }}>
    <input type="password" aria-label={`New password for ${account.full_name}`} placeholder="New password (10+ chars)" minLength="10" maxLength="128" value={password} onChange={event => setPassword(event.target.value)} required />
    <button className="text-button" type="submit" disabled={busy}>Set</button>
    <button className="text-button" type="button" onClick={() => setExpanded(false)}>Cancel</button>
  </form>;
}

function FarmEditor({ account, busy, onSave }) {
  const [farmName, setFarmName] = useState(account.farm_name || '');
  const [farmLocation, setFarmLocation] = useState(account.farm_location || '');
  useEffect(() => {
    setFarmName(account.farm_name || '');
    setFarmLocation(account.farm_location || '');
  }, [account.farm_name, account.farm_location]);

  return <form className="farm-editor" onSubmit={event => { event.preventDefault(); onSave(farmName, farmLocation); }}>
    <input aria-label={`Farm name for ${account.full_name}`} value={farmName} onChange={event => setFarmName(event.target.value)} maxLength="200" placeholder="Farm name" />
    <input aria-label={`Farm location for ${account.full_name}`} value={farmLocation} onChange={event => setFarmLocation(event.target.value)} maxLength="200" placeholder="Farm location" />
    <button className="text-button" type="submit" disabled={busy}>Save farm</button>
  </form>;
}

function Footer() {
  return <footer><img src="/CADD LGO2.jpg" alt="" /><span><strong>CADD-System</strong> : Cassava Disease Detection System</span><span className="footer-right">Developped by @Jonathan MUNGO & @UMUHOZAWASE Pascaline</span></footer>;
}

export default Portal;
