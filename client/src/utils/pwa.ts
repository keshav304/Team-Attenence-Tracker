/**
 * PWA utilities — service-worker registration & push subscription management.
 */

/* ── Service Worker Registration ──────────────── */

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service workers are not supported in this browser.');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    });

    // Listen for updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            // A new version is available — user will get it on next navigation
            console.info('[PWA] New service worker activated.');
          }
        });
      }
    });

    console.info('[PWA] Service worker registered:', registration.scope);
    return registration;
  } catch (error) {
    console.error('[PWA] Service worker registration failed:', error);
    return null;
  }
}

/* ── Push Subscription ────────────────────────── */

/**
 * VAPID public key injected at build time via env variable.
 * Generate keys with: npx web-push generate-vapid-keys
 */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/**
 * Convert a URL-safe base64 VAPID key to a Uint8Array that the PushManager
 * expects as `applicationServerKey`.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Check whether the browser supports push notification APIs (service worker, PushManager, Notification). Does NOT check Notification.permission. */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Current notification permission state. Returns 'default' if Notification API is unavailable. */
export function getNotificationPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'default';
  return Notification.permission;
}

/**
 * Request permission and subscribe to push.
 * Returns the `PushSubscription` object (which must be sent to the server),
 * or `null` if the user denied or something failed.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    console.warn('[PWA] Push is not supported.');
    return null;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.warn('[PWA] VAPID_PUBLIC_KEY is not configured. Set VITE_VAPID_PUBLIC_KEY in .env');
    return null;
  }

  // Request notification permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.info('[PWA] Notification permission denied.');
    return null;
  }

  const registration = await navigator.serviceWorker.ready;

  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });

    console.info('[PWA] Push subscription created.');
    return subscription;
  } catch (error) {
    console.error('[PWA] Failed to subscribe to push:', error);
    return null;
  }
}

/**
 * Unsubscribe the current push subscription.
 * Returns `true` if successful.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      console.info('[PWA] Push subscription removed.');
      return true;
    }
    return false;
  } catch (error) {
    console.error('[PWA] Failed to unsubscribe from push:', error);
    return false;
  }
}

/**
 * Get existing push subscription (if any) without requesting permission.
 */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}
