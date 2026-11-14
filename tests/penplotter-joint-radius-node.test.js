// tests/penplotter-joint-radius-node.test.js - TASK 629 (G4): Pen Plotter's Design tab uses the shared JOINT_RADIUS default (no plotter override).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';

const app = await open({ host: 'penplotter' });
try {
  assert.strictEqual(SettingsManager.get('JOINT_RADIUS'), SettingsManager.getDefault('JOINT_RADIUS'), 'the shared default joint radius');
  console.log('PASS penplotter joint radius');
} finally { await app.close(); }
process.exit(0);
