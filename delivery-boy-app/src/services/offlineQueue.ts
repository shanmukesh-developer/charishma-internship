import AsyncStorage from '@react-native-async-storage/async-storage';

export interface OfflineAction {
  id: string;
  type: 'ACCEPT_ORDER' | 'UPDATE_STATUS' | 'ARRIVE_GATE';
  orderId: string;
  payload?: any;
  timestamp: number;
}

const STORAGE_OFFLINE_QUEUE_KEY = '@zenvy_native_offline_queue';

export async function getOfflineQueue(): Promise<OfflineAction[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Failed to read offline queue', err);
    return [];
  }
}

export async function enqueueOfflineAction(action: Omit<OfflineAction, 'id' | 'timestamp'>): Promise<OfflineAction> {
  const queue = await getOfflineQueue();
  const newAction: OfflineAction = {
    ...action,
    id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    timestamp: Date.now(),
  };
  queue.push(newAction);
  await AsyncStorage.setItem(STORAGE_OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  return newAction;
}

export async function clearOfflineQueue(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_OFFLINE_QUEUE_KEY);
}

export async function flushOfflineQueue(
  apiFetch: (endpoint: string, options?: RequestInit) => Promise<any>
): Promise<{ processed: number; errors: number }> {
  const queue = await getOfflineQueue();
  if (queue.length === 0) return { processed: 0, errors: 0 };

  let processed = 0;
  let errors = 0;
  const remainingQueue: OfflineAction[] = [];

  for (const action of queue) {
    try {
      if (action.type === 'ACCEPT_ORDER') {
        await apiFetch(`/delivery/accept/${action.orderId}`, { method: 'PUT' });
      } else if (action.type === 'UPDATE_STATUS') {
        await apiFetch(`/delivery/status/${action.orderId}`, {
          method: 'PUT',
          body: JSON.stringify(action.payload || {}),
        });
      } else if (action.type === 'ARRIVE_GATE') {
        await apiFetch(`/delivery/arrive/${action.orderId}`, { method: 'PUT' });
      }
      processed++;
    } catch (err) {
      console.warn(`Failed to sync offline action ${action.id}:`, err);
      errors++;
      remainingQueue.push(action);
    }
  }

  await AsyncStorage.setItem(STORAGE_OFFLINE_QUEUE_KEY, JSON.stringify(remainingQueue));
  return { processed, errors };
}
