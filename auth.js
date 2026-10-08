"use strict";

const HisabAIAuth = (() => {
 const ACCOUNTS_KEY = "hisabai-accounts-v1";
 const SESSION_KEY = "hisabai-local-session-v1";
 const HASH_ITERATIONS = 120000;
 const EMPTY_STATE = {tx: [], customers: [], products: [], demoData: false, revision: 0};

 function normalizeIdentifier(identifier) {
  const value = String(identifier ?? "").trim();
  return value.includes("@") ? value.toLowerCase() : value.replace(/[\s()-]/g, "");
 }

 function readAccounts() {
  const raw = localStorage.getItem(ACCOUNTS_KEY);
  if (!raw) return [];
  const accounts = JSON.parse(raw);
  if (!Array.isArray(accounts)) throw new Error("Saved accounts have an invalid format.");
  return accounts;
 }

 function writeAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
 }

 function stateKey(identifier) {
  return `hisabai-business-state-v1:${encodeURIComponent(identifier)}`;
 }

 function accountFor(identifier) {
  const normalized = normalizeIdentifier(identifier);
  return readAccounts().find(account => account.identifier === normalized) || null;
 }

 function publicAccount(account) {
  return {
   identifier: account.identifier,
   name: account.name,
   twoStepEnabled: account.twoStepEnabled === true,
   demoDataPending: account.demoDataPending === true
  };
 }

 function accountError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
 }

 function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
 }

 async function makeVerifier(secret) {
  if (!globalThis.crypto?.subtle) {
   throw new Error("Secure browser storage is unavailable. Use this site on HTTPS or localhost.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
   {name: "PBKDF2", salt, iterations: HASH_ITERATIONS, hash: "SHA-256"},
   key,
   256
  );
  return {salt: toBase64(salt), hash: toBase64(bits)};
 }

 async function verifySecret(secret, verifier) {
  if (!verifier || typeof verifier.salt !== "string" || typeof verifier.hash !== "string") return false;
  try {
   const salt = Uint8Array.from(atob(verifier.salt), character => character.charCodeAt(0));
   const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), "PBKDF2", false, ["deriveBits"]);
   const bits = await crypto.subtle.deriveBits(
    {name: "PBKDF2", salt, iterations: HASH_ITERATIONS, hash: "SHA-256"},
    key,
    256
   );
   const actual = toBase64(bits);
   if (actual.length !== verifier.hash.length) return false;
   let difference = 0;
   for (let index = 0; index < actual.length; index++) {
    difference |= actual.charCodeAt(index) ^ verifier.hash.charCodeAt(index);
   }
   return difference === 0;
  } catch (error) {
   if (error instanceof DOMException || error instanceof TypeError) return false;
   throw error;
  }
 }

 function getLegacyAccount(identifier) {
  return accountFor(identifier);
 }

 async function registerAccount(details) {
  const name = String(details.name ?? "").trim();
  const identifier = normalizeIdentifier(details.identifier);
  const pin = String(details.pin ?? "");
  const password = String(details.password ?? "");
  if (!name || name.length > 80 || !identifier) {
   throw accountError("Enter your name and email or phone number.");
  }
  if (identifier.length > 254 || /[\u0000-\u001f\u007f-\u009f]/u.test(identifier)) {
   throw accountError("Enter a valid email or phone number.");
  }
  if (!/^\d{4}$/.test(pin)) throw accountError("Enter a 4-digit PIN.");
  if (password.length < 8 || password.length > 128) {
   throw accountError("Password must be between 8 and 128 characters.");
  }
  const accounts = readAccounts();
  if (accounts.some(account => account.identifier === identifier)) {
   throw accountError("An account with this email or phone number already exists.", 409);
  }
  const account = {
   identifier,
   name,
   pin: await makeVerifier(pin),
   password: await makeVerifier(password),
   twoStepEnabled: false,
   demoDataPending: true
  };
  accounts.push(account);
  writeAccounts(accounts);
  localStorage.setItem(stateKey(identifier), JSON.stringify(EMPTY_STATE));
  return publicAccount(account);
 }

 async function login(identifier, pin) {
  const account = accountFor(identifier);
  if (!account || !await verifySecret(pin, account.pin)) {
   throw accountError("That email/phone and PIN don't match an account. If you haven't registered yet, create an account first.", 401);
  }
  if (account.twoStepEnabled === true) {
   return {requires_password: true, account: publicAccount(account)};
  }
  sessionStorage.setItem(SESSION_KEY, account.identifier);
  return {requires_password: false, account: publicAccount(account)};
 }

 async function loginPassword(identifier, password) {
  const account = accountFor(identifier);
  if (!account || account.twoStepEnabled !== true || !await verifySecret(password, account.password)) {
   throw accountError("That password does not match the saved account.", 401);
  }
  sessionStorage.setItem(SESSION_KEY, account.identifier);
  return {account: publicAccount(account)};
 }

 function getSession() {
  const identifier = sessionStorage.getItem(SESSION_KEY);
  const account = identifier ? accountFor(identifier) : null;
  if (!account) throw accountError("No active sign-in.", 401);
  return {account: publicAccount(account)};
 }

 function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  return {};
 }

 function loadState() {
  const {account} = getSession();
  const saved = localStorage.getItem(stateKey(account.identifier));
  if (!saved) return {...EMPTY_STATE};
  const state = JSON.parse(saved);
  if (!state || !Array.isArray(state.tx) || !Array.isArray(state.customers) || !Array.isArray(state.products)) {
   throw new Error("Saved business records have an invalid format and were not loaded.");
  }
  return {
   tx: state.tx,
   customers: state.customers,
   products: state.products,
   demoData: state.demoData === true,
   revision: Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0
  };
 }

 function saveState(payload) {
  const {account} = getSession();
  const current = loadState();
  if (payload.revision !== current.revision) {
   throw accountError("These business records changed in another tab. Reload the records and try again.", 409);
  }
  const state = {
   tx: payload.tx,
   customers: payload.customers,
   products: payload.products,
   demoData: payload.demoData === true,
   revision: current.revision + 1
  };
  localStorage.setItem(stateKey(account.identifier), JSON.stringify(state));
  return {revision: state.revision};
 }

 function setTwoStep(enabled) {
  if (typeof enabled !== "boolean") throw accountError("Choose whether to enable two-step verification.");
  const {account} = getSession();
  const accounts = readAccounts();
  const index = accounts.findIndex(item => item.identifier === account.identifier);
  if (index < 0) throw accountError("No active sign-in.", 401);
  accounts[index].twoStepEnabled = enabled;
  writeAccounts(accounts);
  return {two_step_enabled: enabled};
 }

 async function updateAccount(identifier, changes) {
  const normalized = normalizeIdentifier(identifier);
  const accounts = readAccounts();
  const index = accounts.findIndex(account => account.identifier === normalized);
  if (index < 0 || sessionStorage.getItem(SESSION_KEY) !== normalized) {
   throw accountError("No active sign-in.", 401);
  }
  const account = accounts[index];
  if (!await verifySecret(changes.currentPin, account.pin)) {
   throw accountError("Your current PIN is incorrect.", 401);
  }
  const updated = {...account};
  if (changes.name !== undefined) {
   const name = String(changes.name).trim();
   if (!name || name.length > 80) throw accountError("Enter a name between 1 and 80 characters.");
   updated.name = name;
  }
  if (changes.pin !== undefined) {
   const pin = String(changes.pin);
   if (!/^\d{4}$/.test(pin)) throw accountError("Enter a new 4-digit PIN.");
   updated.pin = await makeVerifier(pin);
  }
  if (changes.password !== undefined) {
   if (!await verifySecret(changes.currentPassword, account.password)) {
    throw accountError("Your current password is incorrect.", 401);
   }
   const password = String(changes.password);
   if (password.length < 8 || password.length > 128) {
    throw accountError("Password must be between 8 and 128 characters.");
   }
   updated.password = await makeVerifier(password);
  }
  accounts[index] = updated;
  writeAccounts(accounts);
  return publicAccount(updated);
 }

 async function resetPassword(identifier, pin, password) {
  const normalized = normalizeIdentifier(identifier);
  const accounts = readAccounts();
  const index = accounts.findIndex(account => account.identifier === normalized);
  if (index < 0 || !await verifySecret(pin, accounts[index].pin)) {
   throw accountError("That email/phone and PIN don't match a saved account.", 401);
  }
  const cleanPassword = String(password);
  if (cleanPassword.length < 8 || cleanPassword.length > 128) {
   throw accountError("Password must be between 8 and 128 characters.");
  }
  accounts[index].password = await makeVerifier(cleanPassword);
  writeAccounts(accounts);
  return publicAccount(accounts[index]);
 }

 function markDemoDataInitialized(identifier) {
  const normalized = normalizeIdentifier(identifier);
  const accounts = readAccounts();
  const account = accounts.find(item => item.identifier === normalized);
  if (!account) throw accountError("No saved account was found.", 404);
  account.demoDataPending = false;
  writeAccounts(accounts);
 }

 return {
  getAccount: getLegacyAccount,
  getSession,
  loadState,
  login,
  loginPassword,
  logout,
  makeVerifier,
  markDemoDataInitialized,
  normalizeIdentifier,
  registerAccount,
  resetPassword,
  saveState,
  setTwoStep,
  updateAccount,
  verifySecret
 };
})();
