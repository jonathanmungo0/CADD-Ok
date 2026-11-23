const topics = [
  {
    keys: ['how to plant', 'how do i plant', 'how should i plant', 'planting cassava', 'grow cassava', 'start a cassava farm'],
    answer: 'Plant healthy cassava stem cuttings in well-drained soil when there is reliable moisture, usually near the start of the rainy season. Use cuttings about 20–25 cm long with several healthy nodes, place them at the locally recommended angle and depth, and space plants about 0.8–1 m apart with roughly 1 m between rows. Keep the field weed-free while plants establish; local variety and extension advice takes priority.'
  },
  {
    keys: ['how long to harvest', 'how long to mature', 'how long does cassava take', 'months until harvest', 'ready to harvest'],
    answer: 'Cassava is commonly harvested about 8–18 months after planting, depending on the variety and intended use. Check root maturity and local variety guidance rather than relying on a fixed date.'
  },
  {
    keys: ['how often water', 'how much water', 'water cassava', 'water the plants', 'does cassava need water', 'irrigate', 'irrigation', 'watering'],
    answer: 'Keep newly planted cassava cuttings moist while they establish, especially if rainfall is delayed. Once established, cassava tolerates dry periods better than many crops, but prolonged drought can reduce growth and root yield. Watering frequency depends on rainfall and soil; avoid waterlogging.'
  },
  {
    keys: ['cutting', 'cuttings', 'stem', 'stems', 'planting material', 'planting materials', 'variety', 'varieties', 'planting stick'],
    answer: 'Use healthy, mature cassava stems from vigorous plants without visible disease or pest damage. Cut stems into planting pieces about 20–25 cm long with several viable nodes. Avoid moving cuttings from fields with suspected cassava disease; ask a local extension officer about suitable varieties.'
  },
  {
    keys: ['spacing', 'distance between', 'row distance', 'plant distance', 'plant population', 'how far apart', 'distance apart'],
    answer: 'Spacing depends on the variety, soil, rainfall, and whether you intercrop. A common starting range is about 1 m between rows and 0.8–1 m between plants, but follow local Rwanda extension recommendations and leave enough space for weeding and root development.'
  },
  {
    keys: ['planting time', 'when to plant', 'when should i plant', 'when should we plant', 'planting season', 'rainy season', 'rainfall', 'drought'],
    answer: 'Plant healthy cassava cuttings when the soil has reliable moisture, commonly near the start of the rainy season. Establishment is slower in dry soil. If rainfall is unreliable, check local planting calendars and protect newly planted cuttings from prolonged drought.'
  },
  {
    keys: ['soil', 'fertilizer', 'fertiliser', 'manure', 'compost', 'fertility', 'nutrient'],
    answer: 'Cassava grows best in well-drained soil; waterlogged soil can damage roots. Improve soil with well-rotted organic matter and use fertilizer only according to a soil test or local extension recommendation. Avoid applying fresh manure directly to planting pieces.'
  },
  {
    keys: ['weed', 'weeds', 'weeding', 'weed control', 'herbicide'],
    answer: 'Keep cassava fields free of weeds during early establishment, especially in the first few months. Weed carefully around young plants to avoid damaging roots and stems. Use herbicides only if locally approved and strictly according to the product label and extension advice.'
  },
  {
    keys: ['mosaic', 'brown streak', 'bacterial blight', 'green mottle', 'green mite', 'whitefly', 'disease', 'symptom', 'symptoms', 'pest', 'pests', 'spots', 'yellowing', 'leaf curl'],
    answer: 'Cassava leaf symptoms can have several causes, and an image alone cannot confirm a diagnosis. Use clean planting material, inspect the whole plant and field, and avoid moving cuttings from affected plants. For suspected cassava mosaic disease, brown streak disease, bacterial blight, green mottle, or mites, consult an agricultural extension officer before taking field-wide action.'
  },
  {
    keys: ['harvest', 'harvesting', 'maturity', 'mature', 'roots', 'root size', 'storage', 'store', 'postharvest', 'post-harvest'],
    answer: 'Harvest timing depends on the variety and intended use; cassava is often harvested roughly 8–18 months after planting. Check root maturity and local variety guidance. Harvest carefully to limit root damage, and process or market roots promptly because fresh cassava roots do not store well.'
  },
  {
    keys: ['intercrop', 'intercropping', 'crop rotation', 'rotation', 'yield', 'yielding'],
    answer: 'Cassava can be included in locally suitable rotations or intercropping systems, but companion crops and timing affect competition for light, water, and nutrients. Use Rwanda-specific extension recommendations, maintain cassava spacing, and avoid replanting with infected cuttings.'
  },
  {
    keys: ['cassava', 'manioc', 'yuca', 'mandioca', 'kasawa'],
    answer: 'I can help with cassava planting material, planting time and spacing, soil and fertility, weeding, cassava pests and diseases, and harvest. Which topic would you like help with?'
  }
];

const otherCropPattern = /\b(?:maize|corn|rice|wheat|beans?|tomatoes?|potatoes?|soybeans?|coffee|bananas?|sorghum|millet|cabbage|onions?|carrots?|groundnuts?|peanuts?)\b/i;
const cassavaPattern = /\b(?:cassava|manioc|yuca|mandioca|kasawa)\b/i;

function containsPhrase(text, phrase) {
  const words = phrase.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(^|[^a-z])${words.join('\\s+')}($|[^a-z])`, 'i').test(text);
}

export function answerCassavaQuestion(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { in_scope: false, answer: 'Enter a question about cassava cultivation.' };
  }

  const question = input.trim();
  if (question.length > 1000) {
    return { in_scope: false, answer: 'Please keep cassava questions under 1,000 characters.' };
  }

  if (otherCropPattern.test(question)) {
    return {
      in_scope: false,
      answer: 'I can only help with cassava cultivation. Ask a question focused on cassava planting, soil, care, pests, diseases, or harvest.'
    };
  }

  const matched = topics.find(topic => topic.keys.some(key => containsPhrase(question, key)));
  if (!matched || (!cassavaPattern.test(question) && matched === topics[topics.length - 1])) {
    return {
      in_scope: false,
      answer: 'I can only help with cassava cultivation. Try asking about cassava cuttings, planting time or spacing, soil, weeds, pests and diseases, or harvest.'
    };
  }

  return {
    in_scope: true,
    answer: matched.answer,
    disclaimer: 'General guidance only. Confirm local varieties, pesticide use, and severe disease concerns with an agricultural extension officer.'
  };
}
