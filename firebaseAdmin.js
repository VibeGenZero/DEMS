const { initializeApp } = require('firebase/app');
const {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch
} = require('firebase/firestore');

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

// Prüfen, welche Firebase-Werte gesetzt sind
const providedKeys = Object.entries(firebaseConfig).filter(([, v]) => v).map(([k]) => k);
const missingKeys = Object.entries(firebaseConfig).filter(([, v]) => !v).map(([k]) => k);

if (providedKeys.length === 0) {
  // Keine Firebase-Konfiguration hinterlegt → lokale SQLite-Datenbank als Fallback.
  console.log('ℹ️ Keine Firebase-Konfiguration gefunden — nutze lokale SQLite-Datenbank (SQLITE_PATH).');
  module.exports = require('./db/sqliteAdapter');
} else if (missingKeys.length > 0) {
  // Teilweise gesetzt → vermutlich ein Konfigurationsfehler, nicht stillschweigend
  // auf SQLite ausweichen.
  console.error(`❌ Unvollständige Firebase-Konfiguration in .env: ${missingKeys.join(', ')}`);
  console.error('   Entweder alle FIREBASE_*-Werte setzen oder alle leer lassen (dann wird SQLite genutzt).');
  process.exit(1);
} else {
  // Vollständige Firebase-Konfiguration → Firestore wie bisher.
  console.log('✅ Datenspeicher: Firebase Firestore');
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  module.exports = {
    db,
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    writeBatch
  };
}
