export interface DeckData {
  lang: 'es' | 'en';
  projects: { id: string; slug: string; title: string; category: string; duration: string; description: string; thumbnail: string; video_url: string }[];
  services: { slug: string; title: string; summary: string }[];
}
export interface Deck { focusWork(index: number): void; focusService(index: number): void; unfocus(): void; dispose(): void }
export function createDeck(root: HTMLElement, data: DeckData): Deck;
