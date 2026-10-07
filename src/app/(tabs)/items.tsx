import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Chips } from '../../components/Chips';
import { ItemsSection } from '../../components/ref/ItemsSection';
import { RefListSection } from '../../components/ref/RefListSection';
import { s } from '../../components/ui';

type Section = 'items' | 'parties' | 'contracts' | 'orgs';
type PartyKind = 'legal' | 'person';

/**
 * Справочник: номенклатура (с ценой), контрагенты (юр. / физ. лица), договоры, свои организации.
 * Договоры заполняются из контрагентов и организаций — данные сторон берутся оттуда.
 */
export default function ReferenceScreen() {
  const params = useLocalSearchParams<{ section?: Section; party?: PartyKind }>();
  const [section, setSection] = useState<Section>(params.section ?? 'items');
  const [party, setParty] = useState<PartyKind>(params.party ?? 'legal');
  useEffect(() => {
    if (params.section) setSection(params.section);
    if (params.party) setParty(params.party);
  }, [params.section, params.party]);

  return (
    <View style={[s.screen, { padding: 16 }]}>
      <Chips value={section} onChange={setSection} options={[
        { value: 'items' as Section, label: 'Номенклатура' },
        { value: 'parties' as Section, label: 'Контрагенты' },
        { value: 'contracts' as Section, label: 'Договоры' },
        { value: 'orgs' as Section, label: 'Организации' },
      ]} />
      {section === 'parties' ? (
        <Chips value={party} onChange={setParty} options={[
          { value: 'legal' as PartyKind, label: 'Юр. лица' },
          { value: 'person' as PartyKind, label: 'Физ. лица' },
        ]} />
      ) : null}
      {section === 'items' ? <ItemsSection />
        : section === 'parties' ? <RefListSection key={party} kind={party} />
          : section === 'contracts' ? <RefListSection kind="contract" />
            : <RefListSection kind="org" />}
    </View>
  );
}
