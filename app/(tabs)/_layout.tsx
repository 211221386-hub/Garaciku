import { Tabs } from 'expo-router';
import { Car, KeyRound, Wrench, Settings, ClipboardCheck } from 'lucide-react-native';
import { Colors } from '@/lib/theme';
import { getSession } from '@/lib/auth';

export default function TabLayout() {
  const role = getSession()?.user.role;
  const canSeeService = role === 1 || role === 2;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarStyle: {
          backgroundColor: Colors.white,
          borderTopColor: Colors.borderLight,
          borderTopWidth: 1,
          height: 64,
          marginBottom: 8,
          marginHorizontal: 8,
          borderRadius: 18,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: 'PlusJakartaSans-Medium',
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Mobil',
          tabBarIcon: ({ size, color }) => <Car size={size} color={color} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="notes"
        options={{
          title: 'Service',
          href: canSeeService ? undefined : null,
          tabBarIcon: ({ size, color }) => <Wrench size={size} color={color} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="service"
        options={{
          title: 'Rental',
          tabBarIcon: ({ size, color }) => <KeyRound size={size} color={color} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="approval"
        options={{
          title: 'Approval',
          tabBarIcon: ({ size, color }) => <ClipboardCheck size={size} color={color} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Pengaturan',
          tabBarIcon: ({ size, color }) => <Settings size={size} color={color} strokeWidth={2.2} />,
        }}
      />
    </Tabs>
  );
}
