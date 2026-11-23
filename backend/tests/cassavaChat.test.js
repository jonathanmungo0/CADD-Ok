import assert from 'node:assert/strict';
import test from 'node:test';
import { answerCassavaQuestion } from '../src/cassavaChat.js';

test('answers how-to-plant questions with planting instructions', () => {
  const result = answerCassavaQuestion('How do I plant cassava?');

  assert.equal(result.in_scope, true);
  assert.match(result.answer, /stem cuttings/i);
  assert.doesNotMatch(result.answer, /Which topic would you like/i);
});

test('answers direct spacing questions with spacing guidance', () => {
  const result = answerCassavaQuestion('How far apart should I plant cassava?');

  assert.equal(result.in_scope, true);
  assert.match(result.answer, /spacing/i);
});

test('answers watering questions with irrigation guidance', () => {
  const result = answerCassavaQuestion('How much water does cassava need?');

  assert.equal(result.in_scope, true);
  assert.match(result.answer, /newly planted cassava cuttings/i);
});

test('declines questions about other crops', () => {
  const result = answerCassavaQuestion('How should I plant maize?');

  assert.equal(result.in_scope, false);
  assert.match(result.answer, /only help with cassava/i);
});

test('asks for a question when the message is blank', () => {
  const result = answerCassavaQuestion('  ');

  assert.equal(result.in_scope, false);
  assert.match(result.answer, /Enter a question/i);
});
