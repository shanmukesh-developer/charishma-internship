importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyASKW2EosQpJjkZMGILrURhoiP7vhjj8TY",
  authDomain: "hostelbites-c77a8.firebaseapp.com",
  projectId: "hostelbites-c77a8",
  messagingSenderId: "785490473159",
  appId: "1:785490473159:web:7e7b7b00cc9e2669000ee2"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title || 'Zenvy Logistics';
  const notificationOptions = {
    body: payload.notification.body || 'New update available.',
    icon: '/logo.png',
    badge: '/logo.png',
    vibrate: [200, 100, 200],
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
