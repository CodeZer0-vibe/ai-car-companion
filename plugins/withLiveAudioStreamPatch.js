/**
 * Expo config plugin that patches react-native-live-audio-stream's iOS native
 * source so it uses the correct audio session options for speaker + Bluetooth.
 *
 * Problem: The library hardcodes AVAudioSessionModeVoiceChat which forces
 * earpiece routing, and omits DefaultToSpeaker / AllowBluetoothA2DP.
 *
 * This plugin runs at prebuild and patches RNLiveAudioStream.m directly.
 */
const { withDangerousMod, createRunOncePlugin } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'with-live-audio-stream-patch';

const withLiveAudioStreamPatch = (config) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const srcFile = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        'react-native-live-audio-stream',
        'ios',
        'RNLiveAudioStream.m',
      );

      if (!fs.existsSync(srcFile)) {
        console.warn(`[${PLUGIN_NAME}] RNLiveAudioStream.m not found, skipping patch`);
        return config;
      }

      let src = fs.readFileSync(srcFile, 'utf-8');

      // Replace the audio session configuration in the start method.
      // Original uses VoiceChat mode (earpiece) and missing DefaultToSpeaker / A2DP.
      const oldOptions =
        'AVAudioSessionCategoryOptionDuckOthers |\n' +
        '                                             AVAudioSessionCategoryOptionAllowBluetooth |\n' +
        '                                             AVAudioSessionCategoryOptionAllowAirPlay';

      const newOptions =
        'AVAudioSessionCategoryOptionDefaultToSpeaker |\n' +
        '                                             AVAudioSessionCategoryOptionDuckOthers |\n' +
        '                                             AVAudioSessionCategoryOptionAllowBluetoothA2DP |\n' +
        '                                             AVAudioSessionCategoryOptionAllowAirPlay';

      if (src.includes(oldOptions)) {
        src = src.replace(oldOptions, newOptions);
        console.log(`[${PLUGIN_NAME}] Patched audio session options`);
      }

      // Replace VoiceChat mode with Default mode.
      // VoiceChat forces earpiece; Default respects the route options above.
      const oldMode = 'mode: AVAudioSessionModeVoiceChat';
      const newMode = 'mode: AVAudioSessionModeDefault';

      if (src.includes(oldMode)) {
        src = src.replace(oldMode, newMode);
        console.log(`[${PLUGIN_NAME}] Patched audio session mode`);
      }

      fs.writeFileSync(srcFile, src, 'utf-8');
      return config;
    },
  ]);

module.exports = createRunOncePlugin(withLiveAudioStreamPatch, PLUGIN_NAME, '1.0.0');
