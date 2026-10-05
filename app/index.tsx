import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { hasValidSession } from '@/lib/auth';
import { Colors } from '@/lib/theme';

export default function IndexRedirectScreen() {
  useEffect(() => {
    if (hasValidSession()) {
      router.replace('/(tabs)');
      return;
    }

    router.replace('/login');
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background }}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}
