# AI Car Companion

A hands-free driving companion for the car dashboard, powered by Gemini Live. You talk to it and it talks back in real time, and it can glance at the road through the camera when you ask, so it works the way a co-pilot would rather than something you tap at while driving.

**Stack:** Expo (SDK 54) · React Native · `@google/genai` (Gemini Live) · streaming audio · on-demand camera vision · built and installed on iOS from a Windows machine

> Work in progress. The real-time voice loop and on-demand vision work end to end on device.

---

## What it does

- **Real-time voice, both ways.** A live Gemini session over WebSocket with streaming audio in and out, so the conversation feels immediate instead of request-and-wait.
- **On-demand camera vision.** When you ask about something ahead, it pushes live camera frames straight into the same Gemini session, rather than routing them through a separate model.
- **Built to survive a car.** The connection handles reconnects, exponential backoff and the session's `goAway` signal, because a phone in a car loses signal constantly.
- **Designed for driving, not tapping.** Layout and interaction follow real automotive UX guidance (NHTSA and Euro NCAP driver-distraction rules, Google's automotive touch-target specs).

## How it's built

An Expo / React Native app that opens a live Gemini session over WebSocket, runs a streaming audio pipeline for continuous speech, and sends on-demand camera frames into the same session for vision. Shipped to a physical iOS device from a Windows development machine.

## Status and what's next

- **Now:** the live voice loop, the vision-on-request path and the resilience handling all work on device.
- **Next:** polishing the dashboard UI and a TestFlight build.
