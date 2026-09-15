const { withAppDelegate, createRunOncePlugin } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-ios-audio-session-lock';
const MARKER = 'configureDashboardPetAudioSession';

function applySwiftPatch(src) {
  let contents = src;

  if (!contents.includes('import AVFAudio')) {
    contents = contents.replace('import Expo\n', 'import Expo\nimport AVFAudio\n');
  }

  if (!contents.includes(`func ${MARKER}`)) {
    const method = `
  private func ${MARKER}() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(
        .playAndRecord,
        mode: .voiceChat,
        options: [.defaultToSpeaker, .allowBluetoothA2DP, .duckOthers]
      )
      try session.setActive(true)
    } catch {
      NSLog("[DashboardPetAudio] Failed to lock AVAudioSession: \\(error)")
    }
  }

`;
    contents = contents.replace('class AppDelegate: ExpoAppDelegate {\n', `class AppDelegate: ExpoAppDelegate {\n${method}`);
  }

  contents = contents.replace(
    'return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
    `    ${MARKER}()\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`
  );

  return contents;
}

function applyObjcPatch(src) {
  let contents = src;

  if (!contents.includes('#import <AVFAudio/AVFAudio.h>')) {
    contents = contents.replace('#import "AppDelegate.h"\n', '#import "AppDelegate.h"\n#import <AVFAudio/AVFAudio.h>\n');
  }

  if (!contents.includes(`- (void)${MARKER}`)) {
    const method = `
- (void)${MARKER}
{
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *error = nil;
  AVAudioSessionCategoryOptions options =
    AVAudioSessionCategoryOptionDefaultToSpeaker |
    AVAudioSessionCategoryOptionAllowBluetoothA2DP |
    AVAudioSessionCategoryOptionDuckOthers;

  [session setCategory:AVAudioSessionCategoryPlayAndRecord
                  mode:AVAudioSessionModeVoiceChat
               options:options
                 error:&error];
  if (error) {
    NSLog(@"[DashboardPetAudio] Failed to set category: %@", error);
  }

  error = nil;
  [session setActive:YES error:&error];
  if (error) {
    NSLog(@"[DashboardPetAudio] Failed to activate session: %@", error);
  }
}

`;
    contents = contents.replace('@implementation AppDelegate\n', `@implementation AppDelegate\n${method}`);
  }

  contents = contents.replace(
    'return [super application:application didFinishLaunchingWithOptions:launchOptions];',
    `  [self ${MARKER}];\n  return [super application:application didFinishLaunchingWithOptions:launchOptions];`
  );

  return contents;
}

const withIOSAudioSessionLock = (config) =>
  withAppDelegate(config, (config) => {
    const { modResults } = config;
    if (modResults.language === 'swift') {
      modResults.contents = applySwiftPatch(modResults.contents);
    } else {
      modResults.contents = applyObjcPatch(modResults.contents);
    }
    return config;
  });

module.exports = createRunOncePlugin(withIOSAudioSessionLock, PLUGIN_NAME, '1.0.0');

