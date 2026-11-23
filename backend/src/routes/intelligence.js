import express from 'express';
import { analyzeLatestReading } from '../intelligence/engine.js';

const router = express.Router();

// GET /api/intelligence/latest
// Analyze the latest sensor reading without controlling the pump.
router.get('/latest', async (_req, res) => {
  try {
    const result = await analyzeLatestReading();

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.json(result);

  } catch (error) {
    console.error('CADD intelligence analysis failed:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Could not analyze the latest sensor reading.'
    });
  }
});

export default router;
