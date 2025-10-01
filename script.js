// Firebase Setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import {
  getDatabase, ref, push, set, get, child,
  onValue, remove, onDisconnect, update
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCsfx6NOlTI83ZEPlQcEuHnoUHMvEHY-Pk",
  authDomain: "chat-encrypt-2fb7c.firebaseapp.com",
  databaseURL: "https://chat-encrypt-2fb7c-default-rtdb.firebaseio.com",
  projectId: "chat-encrypt-2fb7c",
  storageBucket: "chat-encrypt-2fb7c.appspot.com",
  messagingSenderId: "752290094183",
  appId: "1:752290094183:web:83a405d6d166c7e17ec8c2",
  measurementId: "G-ZRWQ61K1M1"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const usersRef = ref(db, "users");
const messagesRef = ref(db, "messages");
const onlineRef = ref(db, "onlineUsers");
const typingRef = ref(db, "typing");

// Global state
let currentUser = null;
let encryptionKey = null;
let messageCleanupInterval = null;
let typingTimeout = null;
let inactivityTimeout = null;
const INACTIVITY_TIMEOUT = 3 * 60 * 60 * 1000; // 3 hours
const FIXED_EXPIRY = 300000; // Always 5 minutes
let lastActivityTime = Date.now();

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  currentUser = localStorage.getItem('chatAppUser');
  encryptionKey = localStorage.getItem('chatAppEncryptionKey');

  if (currentUser) {
    if (encryptionKey) {
      loginSuccess();
    } else {
      showSecuritySetup();
    }
  } else {
    showScreen('loginScreen');
  }

  document.getElementById('userInput').addEventListener('input', updateTyping);
  document.getElementById('coverScreen').addEventListener('dblclick', toggleCoverScreen);

  setupActivityTracking();
});

// ----------------- Activity tracking -----------------
function setupActivityTracking() {
  ['mousemove', 'keydown', 'click', 'scroll'].forEach(event => {
    document.addEventListener(event, resetInactivityTimer, { passive: true });
  });
}
function resetInactivityTimer() {
  lastActivityTime = Date.now();
  if (inactivityTimeout) clearTimeout(inactivityTimeout);
  if (currentUser) {
    inactivityTimeout = setTimeout(checkInactivity, 60000);
  }
}
function checkInactivity() {
  const currentTime = Date.now();
  const inactiveDuration = currentTime - lastActivityTime;
  if (inactiveDuration >= INACTIVITY_TIMEOUT) {
    logout();
  } else {
    inactivityTimeout = setTimeout(checkInactivity, 60000);
  }
}

// ----------------- Screen management -----------------
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.style.display = 'none';
  });
  document.getElementById(screenId).style.display = 'flex';
}

// ----------------- Auth -----------------
window.registerUser = async function () {
  const name = document.getElementById("nameInput").value.trim();
  const pass = document.getElementById("passInput").value.trim();
  if (!name || !pass) return showError("Please fill all fields", 'authMsg');

  const userRef = child(usersRef, name);
  const snapshot = await get(userRef);
  if (snapshot.exists()) return showError("Username already exists", 'authMsg');

  await set(userRef, { password: pass });
  currentUser = name;
  localStorage.setItem('chatAppUser', currentUser);
  showSecuritySetup();
};

window.loginUser = async function () {
  const name = document.getElementById("nameInput").value.trim();
  const pass = document.getElementById("passInput").value.trim();
  if (!name || !pass) return showError("Please fill all fields", 'authMsg');

  const userRef = child(usersRef, name);
  const snapshot = await get(userRef);
  if (!snapshot.exists()) return showError("User not found", 'authMsg');
  if (snapshot.val().password !== pass) return showError("Incorrect password", 'authMsg');

  currentUser = name;
  localStorage.setItem('chatAppUser', currentUser);
  showSecuritySetup();
};

// ----------------- Security Setup -----------------
function showSecuritySetup() {
  showScreen('securitySetup');
  document.getElementById('userAvatar').textContent = currentUser.charAt(0).toUpperCase();
}

window.completeSecuritySetup = function () {
  const key = document.getElementById("encryptionKey").value;
  const confirmKey = document.getElementById("confirmEncryptionKey").value;

  if (!key || !confirmKey) return showError("Please enter encryption key", 'securityMsg');
  if (key !== confirmKey) return showError("Keys don't match", 'securityMsg');
  if (key.length < 8) return showError("Key must be at least 8 characters", 'securityMsg');

  encryptionKey = key;

  const keyHash = CryptoJS.SHA256(key).toString();
  update(ref(db, `users/${currentUser}`), {
    encryptionKeyHash: keyHash,
    messageExpiry: FIXED_EXPIRY
  });

  localStorage.setItem('chatAppEncryptionKey', key);
  localStorage.setItem('chatAppMessageExpiry', FIXED_EXPIRY.toString());

  loginSuccess();
};

// ----------------- Login Success -----------------
function loginSuccess() {
  showScreen('chatScreen');
  document.getElementById("welcomeUser").textContent = currentUser;
  document.getElementById('userAvatar').textContent = currentUser.charAt(0).toUpperCase();

  set(ref(db, "onlineUsers/" + currentUser), true);
  onDisconnect(ref(db, "onlineUsers/" + currentUser)).remove();

  if (!messageCleanupInterval) {
    messageCleanupInterval = setInterval(cleanupExpiredMessages, 60000);
  }

  resetInactivityTimer();
  loadMessages();
  showOnlineUsers();
  setupTypingIndicator();
}

// ----------------- Error helper -----------------
function showError(msg, elementId) {
  const element = document.getElementById(elementId);
  element.textContent = msg;
  setTimeout(() => { element.textContent = ''; }, 5000);
}

// ----------------- Encryption -----------------
function encryptMessage(text) {
  return CryptoJS.AES.encrypt(text, encryptionKey).toString();
}
function decryptMessage(ciphertext) {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, encryptionKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return "[Unable to decrypt message]";
  }
}

// ----------------- Messaging -----------------
window.sendMessage = function () {
  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  const encryptedText = encryptMessage(text);

  const data = {
    sender: currentUser,
    text: encryptedText,
    timestamp: Date.now(),
    expiresAt: Date.now() + FIXED_EXPIRY
  };

  push(messagesRef, data);
  input.value = "";
  stopTyping();
  resetInactivityTimer();
};

function loadMessages() {
  onValue(messagesRef, (snapshot) => {
    const chatBox = document.getElementById("chatBox");
    chatBox.innerHTML = "";

    const messages = [];
    snapshot.forEach((child) => {
      messages.push({ key: child.key, ...child.val() });
    });
    messages.sort((a, b) => a.timestamp - b.timestamp);

    messages.forEach((msg) => {
      if (msg.expiresAt && msg.expiresAt < Date.now()) return;

      const isUser = msg.sender === currentUser;
      const decryptedText = decryptMessage(msg.text);
      addMessage(decryptedText, isUser ? "user" : "other", msg.sender, msg.key, isUser, msg.expiresAt);
    });

    resetInactivityTimer();
  });
}

function cleanupExpiredMessages() {
  get(messagesRef).then((snapshot) => {
    const updates = {};
    const now = Date.now();
    snapshot.forEach((child) => {
      const msg = child.val();
      if (msg.expiresAt && msg.expiresAt < now) {
        updates[child.key] = null;
      }
    });
    if (Object.keys(updates).length > 0) {
      update(messagesRef, updates);
    }
  });
}

function addMessage(text, type, senderName, msgId, allowDelete, expiresAt) {
  const chatBox = document.getElementById("chatBox");
  const msg = document.createElement("div");
  msg.className = `message message-${type}`;

  let messageHtml = `
    <span class="message-sender">${senderName}</span>
    <span class="message-text">${text}</span>
    <span class="message-time">${formatTime(msgId)}</span>
  `;

  if (expiresAt) {
    messageHtml += `<div class="expiry-tag"><i class="far fa-clock"></i> ${formatTimeRemaining(expiresAt)}</div>`;
  }

  msg.innerHTML = messageHtml;

  if (allowDelete) {
    const delBtn = document.createElement("button");
    delBtn.className = "message-action";
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteMessage(msgId);
    };
    msg.insertAdjacentElement('beforeend', delBtn);
  }

  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function formatTime(timestamp) {
  const date = new Date(parseInt(timestamp));
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function formatTimeRemaining(timestamp) {
  const now = Date.now();
  const diff = timestamp - now;
  if (diff <= 0) return "Expired";
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

window.clearChat = function () {
  if (confirm("Delete all messages? This cannot be undone.")) {
    remove(messagesRef);
  }
};
function deleteMessage(id) {
  remove(child(messagesRef, id));
}

// ----------------- Logout -----------------
window.logout = function () {
  localStorage.removeItem('chatAppUser');
  localStorage.removeItem('chatAppEncryptionKey');
  localStorage.removeItem('chatAppMessageExpiry');

  if (messageCleanupInterval) {
    clearInterval(messageCleanupInterval);
    messageCleanupInterval = null;
  }
  if (inactivityTimeout) {
    clearTimeout(inactivityTimeout);
    inactivityTimeout = null;
  }

  remove(ref(db, "onlineUsers/" + currentUser));
  remove(ref(db, "typing/" + currentUser));

  currentUser = null;
  encryptionKey = null;

  showScreen('loginScreen');
};

// ----------------- Online + Typing -----------------
function showOnlineUsers() {
  onValue(onlineRef, (snapshot) => {
    const list = [];
    snapshot.forEach(child => {
      if (child.key !== currentUser) {
        list.push(`<span class="online-user">${child.key}</span>`);
      }
    });
    document.getElementById("onlineUsers").innerHTML = list.join("") || "No other users online";
  });
}

function setupTypingIndicator() {
  // Listen both typing + online in one go
  onValue(typingRef, (typingSnap) => {
    onValue(onlineRef, (onlineSnap) => {
      const typers = [];
      typingSnap.forEach((child) => {
        if (child.key !== currentUser && child.val()) {
          if (onlineSnap.hasChild(child.key)) {
            typers.push(child.key);
          }
        }
      });

      const indicator = document.getElementById("typingIndicator");
      if (typers.length > 0) {
        indicator.innerHTML = `<i class="fas fa-pencil-alt"></i> ${typers.join(", ")} ${typers.length > 1 ? 'are' : 'is'} typing...`;
      } else {
        indicator.innerHTML = "";
      }
    });
  });
}

function updateTyping() {
  const input = document.getElementById("userInput");
  if (input.value.length > 0) {
    set(ref(db, "typing/" + currentUser), true);
    if (!typingTimeout) typingTimeout = setTimeout(stopTyping, 5000);
  } else {
    stopTyping();
  }
  resetInactivityTimer();
}
function stopTyping() {
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
  set(ref(db, "typing/" + currentUser), false);
}

// ----------------- Stealth Mode -----------------
window.toggleCoverScreen = function () {
  const coverScreen = document.getElementById("coverScreen");
  coverScreen.style.display = (coverScreen.style.display === "none") ? "flex" : "none";
  resetInactivityTimer();
};


//---------------- other ---------------


