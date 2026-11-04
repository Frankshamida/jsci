// A verse for the day, picked from this list by date. Bundled in the app on
// purpose: generating one with AI on every open would cost API tokens.
export const VERSES = [
  { text: 'Sing to the Lord a new song; sing to the Lord, all the earth.', ref: 'Psalm 96:1' },
  { text: 'Let everything that has breath praise the Lord.', ref: 'Psalm 150:6' },
  { text: 'Come, let us sing for joy to the Lord; let us shout aloud to the Rock of our salvation.', ref: 'Psalm 95:1' },
  { text: 'I will praise you, Lord, with all my heart; I will tell of all your wonderful deeds.', ref: 'Psalm 9:1' },
  { text: 'Sing to him a new song; play skillfully, and shout for joy.', ref: 'Psalm 33:3' },
  { text: 'Whatever you do, work at it with all your heart, as working for the Lord.', ref: 'Colossians 3:23' },
  { text: 'Let the message of Christ dwell among you richly as you sing psalms, hymns, and songs from the Spirit.', ref: 'Colossians 3:16' },
  { text: 'My lips will shout for joy when I sing praise to you — I whom you have delivered.', ref: 'Psalm 71:23' },
  { text: 'Praise him with the sounding of the trumpet, praise him with the harp and lyre.', ref: 'Psalm 150:3' },
  { text: 'Through Jesus, therefore, let us continually offer to God a sacrifice of praise.', ref: 'Hebrews 13:15' },
  { text: 'The Lord is my strength and my shield; my heart trusts in him, and he helps me. My heart leaps for joy.', ref: 'Psalm 28:7' },
  { text: 'Each of you should use whatever gift you have received to serve others.', ref: '1 Peter 4:10' },
  { text: 'Shout for joy to the Lord, all the earth. Worship the Lord with gladness.', ref: 'Psalm 100:1-2' },
  { text: 'I will sing of the Lord’s great love forever.', ref: 'Psalm 89:1' },
];

export function verseOfTheDay(date = new Date()) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return VERSES[day % VERSES.length];
}
