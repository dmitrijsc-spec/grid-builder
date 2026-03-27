export const CHIP_NOMINALS = [
  '1',
  '2',
  '5',
  '10',
  '25',
  '50',
  '100',
  '250',
  '500',
  '1K',
  '2K',
  '5K',
] as const

export type ChipNominal = (typeof CHIP_NOMINALS)[number]

export const CHIP_LOCAL_SRC: Record<ChipNominal, string> = {
  '1': new URL('../assets/chips/1.svg', import.meta.url).href,
  '2': new URL('../assets/chips/2.svg', import.meta.url).href,
  '5': new URL('../assets/chips/5.svg', import.meta.url).href,
  '10': new URL('../assets/chips/10.svg', import.meta.url).href,
  '25': new URL('../assets/chips/25.svg', import.meta.url).href,
  '50': new URL('../assets/chips/50.svg', import.meta.url).href,
  '100': new URL('../assets/chips/900.svg', import.meta.url).href,
  '250': new URL('../assets/chips/250.svg', import.meta.url).href,
  '500': new URL('../assets/chips/500.svg', import.meta.url).href,
  '1K': new URL('../assets/chips/4k.svg', import.meta.url).href,
  '2K': new URL('../assets/chips/2k.svg', import.meta.url).href,
  '5K': new URL('../assets/chips/5k.svg', import.meta.url).href,
}

export const CHIP_REMOTE_FALLBACK_SRC: Partial<Record<ChipNominal, string>> = {
  '1': 'https://www.figma.com/api/mcp/asset/fcfd01de-62de-4c92-8eae-6317635d1dd9',
  '2': 'https://www.figma.com/api/mcp/asset/fcfd01de-62de-4c92-8eae-6317635d1dd9',
  '5': 'https://www.figma.com/api/mcp/asset/fcfd01de-62de-4c92-8eae-6317635d1dd9',
  '10': 'https://www.figma.com/api/mcp/asset/14d4c789-12df-40b2-9d32-d94cb7be0e0e',
  '25': 'https://www.figma.com/api/mcp/asset/e0f0484d-9a32-472b-92b5-4662304eab8d',
  '50': 'https://www.figma.com/api/mcp/asset/163036eb-12f2-40b1-8bce-7e05eaa2afd4',
  '100': 'https://www.figma.com/api/mcp/asset/4163cf24-28fe-47ac-bbe1-96003cc497e0',
  '250': 'https://www.figma.com/api/mcp/asset/4b08b4f0-e16b-47e2-88dc-8263b22f7269',
}

export function chipNominalFromValue(value: number): ChipNominal {
  return String(value) as ChipNominal
}

export function chipSourceCandidates(nominal: ChipNominal): string[] {
  const candidates = [CHIP_LOCAL_SRC[nominal]]
  const remote = CHIP_REMOTE_FALLBACK_SRC[nominal]
  if (remote) candidates.push(remote)
  return candidates
}
