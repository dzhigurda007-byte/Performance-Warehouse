import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { qrSvg } from '../lib/qr';
import { colors } from './ui';

export function QrView({ value, size = 160, caption }: { value: string; size?: number; caption?: string }) {
  const xml = useMemo(() => qrSvg(value), [value]);
  return (
    <View style={{ alignItems: 'center', paddingVertical: 8 }}>
      <View style={{ backgroundColor: '#fff', padding: 6, borderRadius: 8 }}>
        <SvgXml xml={xml} width={size} height={size} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>{caption ?? value}</Text>
    </View>
  );
}
