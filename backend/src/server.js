import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import multer from 'multer';

import { pool } from './config/db.js';
import { predictCassavaDisease } from './services/predictionService.js';
import iotRoutes from './routes/iot.js';
import intelligenceRoutes from './routes/intelligence.js';
import { answerCassavaQuestion } from './cassavaChat.js';
import {
  createToken,
  hashPassword,
  requireAdmin,
  requireAuth,
  verifyPassword
} from './auth.js';

const app = express();

// ==========================================
// 1. SERVER CONFIGURATION
// ==========================================

const PORT = Number(process.env.PORT || 4000);
const HOST = '0.0.0.0';
const configuredFrontendOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://10.7.32.61:4000',
   'http://10.7.32.61:5173',
  ...configuredFrontendOrigins
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '2mb' }));

// ==========================================
// 2. IMAGE UPLOAD CONFIGURATION
// ==========================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter(_req, file, callback) {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error('Upload a JPG, PNG, or WEBP image.'));
    }
  }
});

// ==========================================
// 3. ROUTE REGISTRATION
// ==========================================

app.use('/api/iot', iotRoutes);

app.use(
  '/api/intelligence',
  requireAuth,
  intelligenceRoutes
);

// ==========================================
// 4. ACTIVITY LOGGING
// ==========================================

async function recordActivity(userId, eventType, details = {}) {
  try {
    await pool.query(
      `INSERT INTO system_activity
       (user_id, event_type, details)
       VALUES ($1, $2, $3)`,
      [userId || null, eventType, JSON.stringify(details)]
    );
  } catch (error) {
    console.error(
      `Activity log failed (${eventType}):`,
      error.message
    );
  }
}

// ==========================================
// 5. USER HELPERS
// ==========================================

function publicUser(user) {
  const {
    password_hash: _passwordHash,
    ...safeUser
  } = user;

  return safeUser;
}

function requireFarmer(req, res, next) {
  if (req.user?.role !== 'farmer') {
    return res.status(403).json({
      error: 'Only farmer accounts can submit a leaf prediction.'
    });
  }

  next();
}

// ==========================================
// 6. FARMER REGISTRATION
// ==========================================

app.post('/api/auth/register', async (req, res) => {
  const fullName =
    typeof req.body?.full_name === 'string'
      ? req.body.full_name.trim()
      : '';

  const email =
    typeof req.body?.email === 'string'
      ? req.body.email.trim().toLowerCase()
      : '';

  const phone =
    typeof req.body?.phone === 'string'
      ? req.body.phone.trim()
      : '';

  const password =
    typeof req.body?.password === 'string'
      ? req.body.password
      : '';

  const farmName =
    typeof req.body?.farm_name === 'string'
      ? req.body.farm_name.trim()
      : '';

  const farmLocation =
    typeof req.body?.farm_location === 'string'
      ? req.body.farm_location.trim()
      : '';

  const language = req.body?.preferred_language || 'en';

  if (!fullName || fullName.length > 200) {
    return res.status(400).json({
      error: 'Enter a full name of 1–200 characters.'
    });
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      error: 'Enter a valid email address.'
    });
  }

  if (phone.length < 7 || phone.length > 50) {
    return res.status(400).json({
      error: 'Enter a valid phone number.'
    });
  }

  if (password.length < 10 || password.length > 128) {
    return res.status(400).json({
      error: 'Password must be 10–128 characters long.'
    });
  }

  if (farmName.length > 200 || farmLocation.length > 200) {
    return res.status(400).json({
      error: 'Farm name and location must be 200 characters or fewer.'
    });
  }

  if (!['en', 'rw', 'fr'].includes(language)) {
    return res.status(400).json({
      error: 'Choose a supported preferred language.'
    });
  }

  let client;

  try {
    client = await pool.connect();

    await client.query('BEGIN');

    const passwordHash = await hashPassword(password);

    const { rows } = await client.query(
      `INSERT INTO users
       (full_name, email, phone, password_hash, role,
        farm_name, farm_location, preferred_language)
       VALUES ($1, $2, $3, $4, 'farmer', $5, $6, $7)
       RETURNING id, full_name, email, phone, role,
       farm_name, farm_location, preferred_language,
       is_active, created_at`,
      [
        fullName,
        email,
        phone,
        passwordHash,
        farmName || null,
        farmLocation || null,
        language
      ]
    );

    const user = rows[0];

    await client.query(
      `INSERT INTO farmers
       (full_name, preferred_language, user_id)
       VALUES ($1, $2, $3)`,
      [fullName, language, user.id]
    );

    await client.query(
      `INSERT INTO system_activity
       (user_id, event_type, details)
       VALUES ($1, $2, $3)`,
      [
        user.id,
        'farmer_registered',
        JSON.stringify({ email })
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      token: createToken(user),
      user
    });

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(console.error);
    }

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'An account with this email or phone number already exists.'
      });
    }

    console.error('Registration failed:', error.message);

    return res.status(500).json({
      error: 'Could not create your account.'
    });

  } finally {
    client?.release();
  }
});

// ==========================================
// 7. USER LOGIN
// ==========================================

app.post('/api/auth/login', async (req, res) => {
  const identifier =
    typeof req.body?.identifier === 'string'
      ? req.body.identifier.trim()
      : '';

  const password =
    typeof req.body?.password === 'string'
      ? req.body.password
      : '';

  if (!identifier || !password) {
    return res.status(400).json({
      error: 'Enter your email or phone number and password.'
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, password_hash,
              role, farm_name, farm_location,
              preferred_language, is_active, created_at
       FROM users
       WHERE lower(email) = $1 OR phone = $2`,
      [identifier.toLowerCase(), identifier]
    );

    const user = rows[0];

    if (
      !user ||
      !user.is_active ||
      !(await verifyPassword(password, user.password_hash))
    ) {
      return res.status(401).json({
        error: 'Email/phone or password is incorrect.'
      });
    }

    await recordActivity(user.id, 'user_login');

    return res.json({
      token: createToken(user),
      user: publicUser(user)
    });

  } catch (error) {
    console.error('Login failed:', error.message);

    return res.status(500).json({
      error: 'Could not sign in. Please try again.'
    });
  }
});

// ==========================================
// 8. AUTHENTICATED USER PROFILE
// ==========================================

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.patch('/api/auth/profile', requireAuth, async (req, res) => {
  const fullName =
    typeof req.body?.full_name === 'string'
      ? req.body.full_name.trim()
      : '';

  const phone =
    typeof req.body?.phone === 'string'
      ? req.body.phone.trim()
      : '';

  const farmName =
    typeof req.body?.farm_name === 'string'
      ? req.body.farm_name.trim()
      : '';

  const farmLocation =
    typeof req.body?.farm_location === 'string'
      ? req.body.farm_location.trim()
      : '';

  const language = req.body?.preferred_language || 'en';

  if (!fullName || fullName.length > 200) {
    return res.status(400).json({
      error: 'Enter a valid full name.'
    });
  }

  if (phone.length < 7 || phone.length > 50) {
    return res.status(400).json({
      error: 'Enter a valid phone number.'
    });
  }

  if (farmName.length > 200 || farmLocation.length > 200) {
    return res.status(400).json({
      error: 'Farm name and location must be 200 characters or fewer.'
    });
  }

  if (!['en', 'rw', 'fr'].includes(language)) {
    return res.status(400).json({
      error: 'Choose a supported preferred language.'
    });
  }

  let client;

  try {
    client = await pool.connect();

    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE users
       SET full_name=$1,
           phone=$2,
           farm_name=$3,
           farm_location=$4,
           preferred_language=$5,
           updated_at=now()
       WHERE id=$6
       RETURNING id, full_name, email, phone, role,
                 farm_name, farm_location, preferred_language,
                 is_active, created_at`,
      [
        fullName,
        phone,
        farmName || null,
        farmLocation || null,
        language,
        req.user.id
      ]
    );

    await client.query(
      `UPDATE farmers
       SET full_name=$1, preferred_language=$2
       WHERE user_id=$3`,
      [fullName, language, req.user.id]
    );

    await client.query('COMMIT');

    return res.json({ user: rows[0] });

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(console.error);
    }

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'That phone number is already in use.'
      });
    }

    console.error('Profile update failed:', error.message);

    return res.status(500).json({
      error: 'Could not update your profile.'
    });

  } finally {
    client?.release();
  }
});

// ==========================================
// 9. ADMIN DASHBOARD SUMMARY
// ==========================================

app.get(
  '/api/admin/summary',
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const [
        farmerCount,
        predictionCount,
        diseaseStats,
        recentPredictions,
        activity
      ] = await Promise.all([
        pool.query(
          "SELECT count(*)::int AS total FROM users WHERE role='farmer'"
        ),

        pool.query(
          'SELECT count(*)::int AS total FROM predictions'
        ),

        pool.query(
          `SELECT disease_name, count(*)::int AS total
           FROM predictions
           GROUP BY disease_name
           ORDER BY total DESC`
        ),

        pool.query(
          `SELECT p.id, p.disease_name, p.confidence,
                  p.created_at, u.full_name AS farmer_name
           FROM predictions p
           LEFT JOIN users u ON u.id=p.user_id
           ORDER BY p.created_at DESC
           LIMIT 8`
        ),

        pool.query(
          `SELECT a.id, a.event_type, a.details,
                  a.created_at, u.full_name AS user_name
           FROM system_activity a
           LEFT JOIN users u ON u.id=a.user_id
           ORDER BY a.created_at DESC
           LIMIT 8`
        )
      ]);

      res.json({
        total_farmers: farmerCount.rows[0].total,
        total_predictions: predictionCount.rows[0].total,
        disease_statistics: diseaseStats.rows,
        recent_predictions: recentPredictions.rows,
        recent_activity: activity.rows
      });

    } catch (error) {
      console.error('Admin summary failed:', error.message);

      res.status(500).json({
        error: 'Could not load administrator dashboard data.'
      });
    }
  }
);

// ==========================================
// 10. ADMIN USER MANAGEMENT
// ==========================================

app.get(
  '/api/admin/users',
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, full_name, email, phone, role,
                farm_name, farm_location, is_active, created_at
         FROM users
         ORDER BY created_at DESC`
      );

      res.json(rows);

    } catch (error) {
      console.error('Admin user list failed:', error.message);

      res.status(500).json({
        error: 'Could not load user accounts.'
      });
    }
  }
);

app.patch(
  '/api/admin/users/:id',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    const role = req.body?.role;
    const isActive = req.body?.is_active;
    const password = req.body?.password;
    const farmName = req.body?.farm_name;
    const farmLocation = req.body?.farm_location;

    if (
      role !== undefined &&
      !['farmer', 'administrator'].includes(role)
    ) {
      return res.status(400).json({
        error: 'Choose a valid account role.'
      });
    }

    if (
      isActive !== undefined &&
      typeof isActive !== 'boolean'
    ) {
      return res.status(400).json({
        error: 'Account status must be enabled or disabled.'
      });
    }

    if (
      password !== undefined &&
      (typeof password !== 'string' ||
        password.length < 10 ||
        password.length > 128)
    ) {
      return res.status(400).json({
        error: 'A reset password must be 10–128 characters long.'
      });
    }

    if (
      [farmName, farmLocation].some(
        value =>
          value !== undefined &&
          (typeof value !== 'string' || value.trim().length > 200)
      )
    ) {
      return res.status(400).json({
        error: 'Farm name and location must be 200 characters or fewer.'
      });
    }

    let client;

    try {
      client = await pool.connect();

      await client.query('BEGIN');

      const { rows: targetRows } = await client.query(
        `SELECT id, role, is_active, farm_name, farm_location
         FROM users
         WHERE id=$1
         FOR UPDATE`,
        [id]
      );

      const target = targetRows[0];

      if (!target) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'User account not found.'
        });
      }

      const nextRole = role ?? target.role;
      const nextActive = isActive ?? target.is_active;

      if (
        String(id) === String(req.user.id) &&
        (!nextActive || nextRole !== 'administrator')
      ) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          error: 'You cannot disable or demote your own administrator account.'
        });
      }

      if (
        target.role === 'administrator' &&
        target.is_active &&
        (nextRole !== 'administrator' || !nextActive)
      ) {
        const { rows: admins } = await client.query(
          `SELECT count(*)::int AS total
           FROM users
           WHERE role='administrator'
             AND is_active=true
             AND id<>$1`,
          [id]
        );

        if (admins[0].total === 0) {
          await client.query('ROLLBACK');

          return res.status(400).json({
            error: 'The last active administrator cannot be disabled or demoted.'
          });
        }
      }

      const passwordHash = password
        ? await hashPassword(password)
        : null;

      const { rows } = await client.query(
        `UPDATE users
         SET role=$1,
             is_active=$2,
             password_hash=COALESCE($3,password_hash),
             farm_name=$5,
             farm_location=$6,
             updated_at=now()
         WHERE id=$4
         RETURNING id, full_name, email, phone, role,
                   farm_name, farm_location, is_active, created_at`,
        [
          nextRole,
          nextActive,
          passwordHash,
          id,
          farmName === undefined
            ? target.farm_name
            : farmName.trim() || null,
          farmLocation === undefined
            ? target.farm_location
            : farmLocation.trim() || null
        ]
      );

      await client.query(
        `INSERT INTO system_activity
         (user_id, event_type, details)
         VALUES ($1, $2, $3)`,
        [
          req.user.id,
          'user_account_updated',
          JSON.stringify({
            target_user_id: id,
            role: nextRole,
            is_active: nextActive,
            password_reset: Boolean(password)
          })
        ]
      );

      await client.query('COMMIT');

      res.json(rows[0]);

    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(console.error);
      }

      console.error('Admin account update failed:', error.message);

      res.status(500).json({
        error: 'Could not update the user account.'
      });

    } finally {
      client?.release();
    }
  }
);

// ==========================================
// 11. ADMIN ACTIVITY HISTORY
// ==========================================

app.get(
  '/api/admin/activity',
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.id, a.event_type, a.details,
                a.created_at, u.full_name AS user_name
         FROM system_activity a
         LEFT JOIN users u ON u.id=a.user_id
         ORDER BY a.created_at DESC
         LIMIT 100`
      );

      res.json(rows);

    } catch (error) {
      console.error('Activity history failed:', error.message);

      res.status(500).json({
        error: 'Could not load system activity.'
      });
    }
  }
);

// ==========================================
// 12. SYSTEM HEALTH CHECK
// ==========================================

app.get('/api/health', async (_req, res) => {
  let database = 'unavailable';

  try {
    await pool.query('SELECT 1');
    database = 'connected';
  } catch (error) {
    console.error('Database health check failed:', error.message);
  }

  let aiService = {
    status: 'unavailable',
    model_loaded: false,
    verifier_loaded: false,
    classes: []
  };

  try {
    const aiUrl = process.env.AI_SERVICE_URL;

    if (!aiUrl) {
      throw new Error('AI_SERVICE_URL is not configured.');
    }

    const aiRes = await fetch(
      `${aiUrl.replace(/\/+$/, '')}/health`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!aiRes.ok) {
      throw new Error(`AI service returned HTTP ${aiRes.status}`);
    }

    const aiHealth = await aiRes.json();

    const predictionMode =
      aiHealth.prediction_mode ||
      (aiHealth.verifier_loaded ? 'cassava_verified' : 'blocked');

    const modelsLoaded = Boolean(
      aiHealth.model_loaded &&
      (
        aiHealth.verifier_loaded ||
        (
          aiHealth.allow_unverified_predictions &&
          predictionMode === 'disease_only_unverified'
        )
      )
    );

    aiService = {
      status: modelsLoaded
        ? predictionMode === 'disease_only_unverified'
          ? 'degraded'
          : 'ready'
        : 'not_ready',

      model_loaded: Boolean(aiHealth.model_loaded),
      verifier_loaded: Boolean(aiHealth.verifier_loaded),
      prediction_mode: predictionMode,
      classes: Array.isArray(aiHealth.classes)
        ? aiHealth.classes
        : [],
      minimum_confidence: aiHealth.minimum_confidence,
      minimum_cassava_confidence: aiHealth.minimum_cassava_confidence,
      tensorflow_version: aiHealth.tensorflow_version
    };

  } catch (error) {
    aiService.error = 'AI service is not reachable.';
    console.error('AI health check failed:', error.message);
  }

  res.json({
    app: 'CADD-System',
    status: 'ok',
    database,
    ai_service: aiService
  });
});

// ==========================================
// 13. FARMER MANAGEMENT
// ==========================================

app.get(
  '/api/farmers',
  requireAuth,
  requireAdmin,
  async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, full_name, phone,
                preferred_language, created_at
         FROM farmers
         ORDER BY full_name`
      );

      res.json(rows);

    } catch (error) {
      console.error('Farmer list failed:', error.message);

      res.status(500).json({
        error: 'Could not load farmers. Check the database connection.'
      });
    }
  }
);

app.post(
  '/api/farmers',
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const fullName =
      typeof req.body?.full_name === 'string'
        ? req.body.full_name.trim()
        : '';

    const phone =
      typeof req.body?.phone === 'string'
        ? req.body.phone.trim()
        : '';

    const language = req.body?.preferred_language || 'en';

    if (!fullName || fullName.length > 200) {
      return res.status(400).json({
        error: 'Farmer name is required and must be at most 200 characters.'
      });
    }

    if (phone.length > 50) {
      return res.status(400).json({
        error: 'Phone number must be 50 characters or fewer.'
      });
    }

    if (!['en', 'rw', 'fr'].includes(language)) {
      return res.status(400).json({
        error: 'Preferred language must be English, Kinyarwanda, or French.'
      });
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO farmers
         (full_name, phone, preferred_language)
         VALUES ($1, $2, $3)
         RETURNING id, full_name, phone,
                   preferred_language, created_at`,
        [fullName, phone || null, language]
      );

      res.status(201).json(rows[0]);

    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'A farmer with this phone number is already registered.'
        });
      }

      console.error('Farmer creation failed:', error.message);

      res.status(500).json({
        error: 'Could not save farmer. Check the database connection.'
      });
    }
  }
);

// ==========================================
// 14. CASSAVA AI CHAT
// ==========================================

app.post('/api/chat', requireAuth, (req, res) => {
  const question = req.body?.message;

  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({
      error: 'Send a cassava cultivation question in the message field.'
    });
  }

  try {
    const result = answerCassavaQuestion(question.trim());
    res.json(result);
  } catch (error) {
    console.error('Cassava chat failed:', error.message);

    res.status(500).json({
      error: 'Could not process your cassava question.'
    });
  }
});

// ==========================================
// 15. CASSAVA DISEASE GUIDANCE
// ==========================================

const guidance = {
  cbb: [
    'Inspect the field and remove heavily affected plants where recommended by local extension guidance.',
    'Use clean, healthy planting material and avoid moving infected cuttings.',
    'Ask an agricultural extension officer to confirm the diagnosis.'
  ],

  cbsd: [
    'Use certified or locally recommended healthy planting material.',
    'Inspect plants for leaf symptoms and root damage; leaf photos alone may not reveal root symptoms.',
    'Seek local extension advice before making field-wide decisions.'
  ],

  cgm: [
    'Inspect leaf undersides for mites and characteristic damage.',
    'Ask an extension officer to confirm the cause before applying any pesticide.',
    'Use only locally approved control methods and follow product labels.'
  ],

  cmd: [
    'Use healthy, disease-free cassava cuttings and locally recommended resistant varieties.',
    'Remove volunteer cassava plants and manage infected plants according to local guidance.',
    'Seek advice from an agricultural extension officer if symptoms are widespread.'
  ],

  healthy: [
    'Continue regular field monitoring.',
    'Use healthy planting material and maintain good field hygiene.',
    'Recheck plants if new symptoms appear.'
  ]
};

const names = {
  cbb: 'Cassava bacterial blight',
  cbsd: 'Cassava brown streak disease',
  cgm: 'Cassava green mite / green-mottle category (verify dataset label)',
  cmd: 'Cassava mosaic disease',
  healthy: 'Healthy cassava'
};

// ==========================================
// 16. CASSAVA DISEASE PREDICTION
// ==========================================

app.post(
  '/api/predictions',
  requireAuth,
  requireFarmer,
  upload.single('image'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: 'Select a cassava leaf image first.'
      });
    }

    try {
      const farmer = await pool.query(
        'SELECT id FROM farmers WHERE user_id=$1',
        [req.user.id]
      );

      if (!farmer.rowCount) {
        return res.status(409).json({
          error: 'Your farm profile is not linked correctly. Contact an administrator.'
        });
      }

      const farmerId = farmer.rows[0].id;

      // Call the Python AI service through predictionService.js
      const aiResult = await predictCassavaDisease(req.file);

      if (!aiResult.ok) {
        const aiError = aiResult.data || {};

        const detail =
          typeof aiError.detail === 'string'
            ? aiError.detail
            : '';

        const verifierNotReady = detail.includes(
          'Cassava verification is not ready'
        );

        return res.status(aiResult.status || 503).json({
          code: verifierNotReady
            ? 'verifier_not_ready'
            : 'ai_model_not_ready',

          error: verifierNotReady
            ? 'Cassava verification is not configured. Train and install the cassava verifier before analyzing photos.'
            : 'The AI service is not ready. Check its health status and model configuration.',

          detail
        });
      }

      // IMPORTANT: Only one prediction declaration
      const prediction = aiResult.data;

      if (!prediction || typeof prediction !== 'object') {
        throw new Error('The AI service returned an invalid prediction.');
      }

      // Handle rejected predictions
      if (prediction.status === 'rejected') {
        const isNotCassava = prediction.reason === 'not_cassava';

        const isVerificationFailure =
          isNotCassava ||
          prediction.reason === 'uncertain_verification';

        const candidates = isVerificationFailure
          ? []
          : Object.entries(prediction.all_scores || {})
              .filter(([classCode, score]) =>
                names[classCode] &&
                Number.isFinite(Number(score))
              )
              .sort((a, b) => Number(b[1]) - Number(a[1]))
              .slice(0, 3)
              .map(([classCode, score]) => ({
                disease_name: names[classCode],
                model_score: Number(score)
              }));

        return res.status(422).json({
          code: isNotCassava
            ? 'not_cassava'
            : prediction.reason,

          error: isNotCassava
            ? 'Plant not recognized. Please upload a clear cassava leaf.'
            : prediction.reason === 'uncertain_verification'
              ? 'Unable to verify the plant. Please upload a clearer cassava leaf image.'
              : `The result is uncertain (highest model score: ${(Number(prediction.confidence) * 100).toFixed(1)}%). Try a clear, well-lit close-up of one cassava leaf. This score is not a verified probability, so the system will not confirm a disease from this image.`,

          confidence: Number.isFinite(Number(prediction.confidence))
            ? Number(prediction.confidence)
            : null,

          cassava_confidence: Number.isFinite(
            Number(prediction.cassava_confidence)
          )
            ? Number(prediction.cassava_confidence)
            : null,

          candidates
        });
      }

      // Validate predicted class
      const key = String(
        prediction.class_code ||
        prediction.predicted_class ||
        ''
      ).toLowerCase();

      if (!names[key]) {
        return res.status(422).json({
          error: 'The AI returned an unknown class. Check the model class mapping.'
        });
      }

      const confidence = Number(prediction.confidence);
      const recommendations = guidance[key];

      const result = {
        plant: 'Cassava (Manihot esculenta)',
        predicted_class: key,
        disease_name: names[key],

        confidence: Number.isFinite(confidence)
          ? confidence
          : null,

        all_scores: prediction.all_scores || {},

        verification_status:
          prediction.verification_status || 'unknown',

        symptoms:
          prediction.symptoms ||
          'Compare visible symptoms with trusted cassava disease guidance; image analysis alone may be inconclusive.',

        recommendations,

        model_version: prediction.model_version || 'unknown'
      };

      // Save prediction in PostgreSQL
      try {
        const saved = await pool.query(
          `INSERT INTO predictions
           (farmer_id, user_id, image_filename, predicted_class,
            disease_name, confidence, all_scores, symptoms,
            recommendations, model_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id, created_at`,
          [
            farmerId,
            req.user.id,
            req.file.originalname,
            key,
            result.disease_name,
            result.confidence,
            JSON.stringify(result.all_scores),
            result.symptoms,
            JSON.stringify(recommendations),
            result.model_version
          ]
        );

        result.id = saved.rows[0].id;
        result.created_at = saved.rows[0].created_at;

        await recordActivity(
          req.user.id,
          'prediction_completed',
          {
            disease_name: result.disease_name,
            prediction_id: result.id
          }
        );

      } catch (dbError) {
        console.error('Prediction save failed:', dbError.message);

        return res.status(500).json({
          error: 'Analysis succeeded, but the result could not be saved. Check the database connection.'
        });
      }

      return res.json(result);

    } catch (error) {
      console.error('Prediction failed:', error);

      return res.status(503).json({
        error: 'Cannot reach the AI service. Start it and verify the model configuration.'
      });
    }
  }
);

// ==========================================
// 17. PREDICTION HISTORY
// ==========================================

app.get('/api/predictions', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.predicted_class, p.disease_name,
              p.confidence, p.symptoms, p.recommendations,
              p.created_at,
              COALESCE(u.full_name, f.full_name) AS farmer_name
       FROM predictions p
       LEFT JOIN users owner ON owner.id=p.user_id
       LEFT JOIN farmers f ON f.id=p.farmer_id
       LEFT JOIN users u ON u.id=owner.id
       WHERE ($1='administrator' OR p.user_id=$2)
       ORDER BY p.created_at DESC
       LIMIT 100`,
      [req.user.role, req.user.id]
    );

    res.json(rows);

  } catch (error) {
    console.error('Prediction history failed:', error.message);

    res.status(500).json({
      error: 'Could not load prediction history. Check the database connection.'
    });
  }
});

// ==========================================
// 18. GLOBAL ERROR HANDLER
// ==========================================

app.use((error, _req, res, _next) => {
  console.error('Server error:', error.message);

  const status = error.status || error.statusCode || 400;

  res.status(status).json({
    error: error.message || 'Request failed'
  });
});

// ==========================================
// 19. START SERVER
// ==========================================

app.listen(PORT, HOST, () => {
  console.log('====================================');
  console.log('       CADD-SYSTEM BACKEND');
  console.log('====================================');
  console.log(`Server: http://${HOST}:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log('====================================');
});