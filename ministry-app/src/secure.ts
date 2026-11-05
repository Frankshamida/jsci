// Where the sign-in token lives: the phone's Keychain / Keystore in the app;
// the browser's storage for this site in the web app.
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { IS_WEB } from './platform';

export const secure = {
  get: (key: string): Promise<string | null> => (IS_WEB ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key)),
  set: (key: string, value: string): Promise<void> => (IS_WEB ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value)),
  remove: (key: string): Promise<void> => (IS_WEB ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key)),
};
