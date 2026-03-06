// ============================================
// Module declarations for packages without bundled types
// ============================================

declare module '@expo/vector-icons' {
  import { ComponentType } from 'react';
  import { TextStyle } from 'react-native';

  interface IconProps {
    name: string;
    size?: number;
    color?: string;
    style?: TextStyle;
  }

  export const Ionicons: ComponentType<IconProps>;
  export const MaterialIcons: ComponentType<IconProps>;
  export const FontAwesome: ComponentType<IconProps>;
  export const Feather: ComponentType<IconProps>;
  export const MaterialCommunityIcons: ComponentType<IconProps>;
}

declare module 'expo-linear-gradient' {
  import { ComponentType, ReactNode } from 'react';
  import { ViewStyle, StyleProp } from 'react-native';

  interface LinearGradientProps {
    colors: string[];
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    locations?: number[];
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
  }

  export const LinearGradient: ComponentType<LinearGradientProps>;
}

declare module 'expo-secure-store' {
  export function getItemAsync(key: string): Promise<string | null>;
  export function setItemAsync(key: string, value: string): Promise<void>;
  export function deleteItemAsync(key: string): Promise<void>;
}

declare module 'react-native-toast-message' {
  import { ComponentType } from 'react';

  interface ToastProps {
    position?: 'top' | 'bottom';
    topOffset?: number;
    bottomOffset?: number;
    visibilityTime?: number;
  }

  interface ToastShowParams {
    type?: 'success' | 'error' | 'info';
    text1?: string;
    text2?: string;
    position?: 'top' | 'bottom';
    visibilityTime?: number;
  }

  const Toast: ComponentType<ToastProps> & {
    show: (params: ToastShowParams) => void;
    hide: () => void;
  };

  export default Toast;
}

declare module 'react-native-gesture-handler' {
  import { ComponentType, ReactNode } from 'react';
  import { ViewStyle } from 'react-native';

  interface GestureHandlerRootViewProps {
    style?: ViewStyle | { flex: number };
    children?: ReactNode;
  }

  export const GestureHandlerRootView: ComponentType<GestureHandlerRootViewProps>;
}

declare module 'react-native-safe-area-context' {
  import { ComponentType, ReactNode } from 'react';

  interface SafeAreaProviderProps {
    children?: ReactNode;
  }

  export const SafeAreaProvider: ComponentType<SafeAreaProviderProps>;
}

declare module '@react-navigation/native' {
  import { ComponentType, ReactNode } from 'react';

  export interface Theme {
    dark: boolean;
    colors: {
      primary: string;
      background: string;
      card: string;
      text: string;
      border: string;
      notification: string;
    };
  }

  export const DefaultTheme: Theme;
  export const DarkTheme: Theme;

  interface NavigationContainerProps {
    theme?: Theme;
    children?: ReactNode;
  }

  export const NavigationContainer: ComponentType<NavigationContainerProps>;
  export function useNavigation(): any;
  export function useRoute(): any;
}

declare module '@react-navigation/native-stack' {
  import { ComponentType } from 'react';

  interface ScreenProps {
    name: string;
    component: ComponentType<any>;
    options?: Record<string, any>;
  }

  interface NavigatorProps {
    screenOptions?: Record<string, any> | ((props: { route: any; navigation: any }) => Record<string, any>);
    children?: any;
  }

  interface StackType {
    Navigator: ComponentType<NavigatorProps>;
    Screen: ComponentType<ScreenProps>;
  }

  export function createNativeStackNavigator<T = any>(): StackType;
}

declare module '@react-navigation/bottom-tabs' {
  import { ComponentType } from 'react';

  interface ScreenProps {
    name: string;
    component: ComponentType<any>;
    options?: Record<string, any>;
  }

  interface TabNavigatorProps {
    screenOptions?: Record<string, any> | ((props: { route: any; navigation: any }) => Record<string, any>);
    children?: any;
  }

  interface TabType {
    Navigator: ComponentType<TabNavigatorProps>;
    Screen: ComponentType<ScreenProps>;
  }

  export function createBottomTabNavigator<T = any>(): TabType;
}

declare module 'expo-status-bar' {
  import { ComponentType } from 'react';

  interface StatusBarProps {
    style?: 'auto' | 'inverted' | 'light' | 'dark';
  }

  export const StatusBar: ComponentType<StatusBarProps>;
}
