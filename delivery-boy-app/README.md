# Zenvy Rider App (Delivery Boy)

This is a fresh Expo TypeScript app built from scratch to serve as the **delivery boy** client for the Zenvy platform.

## Features
- Separate category sections: **Fruits**, **Food**, **Groceries**
- Time‑slot based order prioritisation (`Before 7:30 PM`, `After 7:30 PM`, `1:00 PM‑6:00 PM`)
- Bulk‑order detection (quantity ≥ 5 or price ≥ ₹500)
- Real‑time push notifications using **expo-notifications**
- Offline queue for pickup/delivery actions
- Premium dark UI with glass‑morphism and smooth micro‑animations

## Getting Started
```bash
cd delivery-boy-app
npm install   # installs dependencies
npm run dev   # starts Metro bundler
```

Connect your Android device:
```bash
adb reverse tcp:8081 tcp:8081
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Architecture Overview
- **src/** – React components and screens
- **utils/** – API helpers, offline queue, notification wrappers
- **assets/** – Custom rider logo (generated separately) used for app icon & splash

See the codebase for detailed implementation.
