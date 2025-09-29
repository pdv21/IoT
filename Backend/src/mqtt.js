import mqtt from 'mqtt';
import dotenv from 'dotenv';
import { pool } from './db.js';
dotenv.config();

const opts = {};
if (process.env.MQTT_USER) {
  opts.username = process.env.MQTT_USER;
  opts.password = process.env.MQTT_PASS;
}
export const mqttClient = mqtt.connect(process.env.MQTT_URL, opts);

mqttClient.on('connect', () => {
  console.log('MQTT connected');
  // Các topic đúng với code ESP32 bạn gửi
  mqttClient.subscribe([
    'esp32/dht/temperature',
    'esp32/dht/humidity',
    'esp32/ldr/value'
  ]);
});
mqttClient.on('error', (e) => console.error('MQTT error:', e.message));
mqttClient.on('reconnect', () => console.log('MQTT reconnecting...'));

// Ghép 3 topic rời thành 1 record ghi DB
const cache = { esp32: { temperature: null, humidity: null, light: null, ts: 0 } };

mqttClient.on('message', async (topic, payload) => {
  const msg = payload.toString().trim();
  try {
    if (topic === 'esp32/dht/temperature') {
      cache.esp32.temperature = parseFloat(msg);
      cache.esp32.ts = Date.now();
    } else if (topic === 'esp32/dht/humidity') {
      cache.esp32.humidity = parseFloat(msg);
      cache.esp32.ts = Date.now();
    } else if (topic === 'esp32/ldr/value') {
      cache.esp32.light = parseInt(msg);
      cache.esp32.ts = Date.now();
    } else return;

    const ready =
      cache.esp32.temperature !== null &&
      cache.esp32.humidity !== null &&
      cache.esp32.light !== null;

    const timeout = Date.now() - cache.esp32.ts > 2000;

    if (ready || timeout) {
      const { temperature, humidity, light } = cache.esp32;
      await pool.query(
        'INSERT INTO SensorData (temperature, humidity, light) VALUES (?, ?, ?)',
        [temperature, humidity, light]
      );
      console.log('Saved SensorData:', { temperature, humidity, light });
      cache.esp32 = { temperature: null, humidity: null, light: null, ts: 0 };
    }
  } catch (e) {
    console.error('MQTT handle error:', e.message, 'topic:', topic, 'msg:', msg);
  }
});

// Publish lệnh đèn theo format bạn muốn (LED1:ON)
export function sendCommandByActionString(actionStr = '') {
  const m = /^LED\s*([123])\s*:\s*(ON|OFF)$/i.exec(actionStr.trim());
  if (!m) throw new Error('Action must look like "LED1:ON" or "LED2:OFF"');
  const led = m[1]; const state = m[2].toUpperCase(); // ON/OFF
  mqttClient.publish(`device/led/${led}`, state, { qos: 1 });
}
export function sendByDeviceName(nameDevice, action) {
  const dev = String(nameDevice || '').trim().toLowerCase();
  const act = String(action || '').trim().toUpperCase();

  if (!['ON', 'OFF'].includes(act)) {
    throw new Error('action must be ON or OFF');
  }

  // Map tên thiết bị sang LED index (giữ đúng format topic đang dùng: device/led/{n})
  const deviceToLed = {
    'light': '1',
    'fan': '2',
    'air conditioner': '3',
    'air-conditioner': '3',
    'air_conditioner': '3',
    'ac': '3',
  };

  const led = deviceToLed[dev];
  if (!led) {
    throw new Error('Unknown device. Use: fan | air conditioner | light');
  }

  const topic = `device/led/${led}`;
  mqttClient.publish(topic, act, { qos: 1 });
}