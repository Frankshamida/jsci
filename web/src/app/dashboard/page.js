'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ROLES, MODULES, hasPermission, hasAnyPermission, getSidebarMenu, getDashboardType, FEATURE_CONTROLS, getFeaturesByCategory, getFeatureCategories, isFeatureEnabled, SIDEBAR_FEATURE_MAP, SIDEBAR_ACTION_FEATURES, isSidebarItemEnabled } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import './dashboard.css';

const Cropper = dynamic(() => import('react-easy-crop'), { ssr: false });

// ============================================
// CONSTANTS
// ============================================
const GROQ_API_KEY = process.env.NEXT_PUBLIC_GROQ_API_KEY || '';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const ALL_ROLES = ['Guest', 'Member', 'Song Leader', 'Leader', 'Pastor', 'Admin', 'Super Admin'];
const ALL_MINISTRIES = ['Praise And Worship', 'Media', 'Dancers', 'Ashers', 'Pastors', 'Teachers'];

// Event types that admin can enable for users
const USER_EVENT_TYPES = ['Event', 'Meeting', 'Bible Study', 'Prayer Meeting', 'Fellowship', 'Outreach', 'Workshop', 'Other'];

// Ministry → Sub-Role mapping (Admin picks ministry, then sub-role dropdown shows these)
const MINISTRY_SUB_ROLES = {
  'Praise And Worship': ['Song Leaders', 'Backup Singer', 'Instrumentalists', 'Dancers'],
  'Media': ['Lyrics', 'Multimedia'],
  'Dancers': ['Choreographer', 'Dancer'],
  'Ashers': ['Head Usher', 'Usher'],
  'Pastors': ['Senior Pastor', 'Associate Pastor', 'Youth Pastor'],
  'Teachers': ['Sunday School', 'Bible Study', 'ISOM'],
};

// Bible version options
const BIBLE_VERSIONS = [
  { value: 'NIV', label: 'NIV', fullName: 'New International Version' },
  { value: 'NKJV', label: 'NKJV', fullName: 'New King James Version' },
  { value: 'AMP', label: 'AMP', fullName: 'Amplified Bible' },
  { value: 'CEV', label: 'CEV', fullName: 'Contemporary English Version' },
  { value: 'CEBUANO', label: 'Cebuano', fullName: 'Cebuano (Ang Biblia)' },
  { value: 'TAGALOG', label: 'Tagalog', fullName: 'Tagalog (Ang Bibliya)' },
];

// Pending page — encouragement verses (instant load)
const PENDING_ENCOURAGEMENT_VERSES = [
  { verse: 'Wait for the Lord; be strong and take heart and wait for the Lord.', reference: 'Psalm 27:14', encouragement: 'God sees your patience and faithfulness. While you wait, He is preparing something beautiful for you. Trust His perfect timing!' },
  { verse: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.', reference: 'Isaiah 40:31', encouragement: 'Your season of waiting is not wasted — it\'s a season of strengthening. God is building endurance and faith in you right now.' },
  { verse: 'Be still before the Lord and wait patiently for him; do not fret when people succeed in their ways.', reference: 'Psalm 37:7', encouragement: 'In the stillness of waiting, God does His most powerful work. Your patience is a beautiful act of trust in Him.' },
  { verse: 'The Lord is good to those whose hope is in him, to the one who seeks him; it is good to wait quietly for the salvation of the Lord.', reference: 'Lamentations 3:25-26', encouragement: 'Every moment of waiting draws you closer to God\'s heart. He rewards those who seek Him with patience and hope.' },
  { verse: 'For the revelation awaits an appointed time; it speaks of the end and will not prove false. Though it linger, wait for it; it will certainly come and will not delay.', reference: 'Habakkuk 2:3', encouragement: 'God\'s promises never fail. What He has planned for you is on its way — it will arrive at exactly the right moment.' },
  { verse: 'I waited patiently for the Lord; he turned to me and heard my cry.', reference: 'Psalm 40:1', encouragement: 'God always hears you. Your patient waiting will be met with His faithful response. He has not forgotten you!' },
  { verse: 'Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.', reference: 'Galatians 6:9', encouragement: 'Don\'t give up! The harvest of blessings is coming. Every step of obedience and patience is planting seeds of joy.' },
  { verse: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.', reference: 'Jeremiah 29:11', encouragement: 'God has already written a beautiful story for your life. This waiting season is just the beginning of something amazing!' },
  { verse: 'The Lord will fight for you; you need only to be still.', reference: 'Exodus 14:14', encouragement: 'Rest in His peace. God is working behind the scenes on your behalf, even when you can\'t see it yet.' },
  { verse: 'Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.', reference: 'Proverbs 3:5-6', encouragement: 'When you trust God completely, He makes everything fall into place. Your path is being straightened even now!' },
  { verse: 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.', reference: 'Romans 8:28', encouragement: 'Even in waiting, God is working all things together for your good. Nothing is wasted in His kingdom!' },
  { verse: 'The Lord your God is with you, the Mighty Warrior who saves. He will take great delight in you; in his love he will no longer rebuke you, but will rejoice over you with singing.', reference: 'Zephaniah 3:17', encouragement: 'Can you imagine? God is singing over you right now! He delights in you and is excited about what\'s ahead.' },
  { verse: 'Come to me, all you who are weary and burdened, and I will give you rest.', reference: 'Matthew 11:28', encouragement: 'If waiting feels heavy, lay it down at His feet. He offers you rest and peace while His timing unfolds.' },
  { verse: 'Being confident of this, that he who began a good work in you will carry it on to completion until the day of Christ Jesus.', reference: 'Philippians 1:6', encouragement: 'God started something wonderful in you, and He never leaves anything unfinished. He will complete His work!' },
  { verse: 'Delight yourself in the Lord, and he will give you the desires of your heart.', reference: 'Psalm 37:4', encouragement: 'As you delight in Him during this waiting season, He is aligning your desires with His perfect will. Beautiful things are ahead!' },
];

// Pending page — Bible fun facts (instant load)
const PENDING_BIBLE_FACTS = [
  { fact: 'The Bible was written over approximately 1,500 years by about 40 different authors from all walks of life — shepherds, kings, fishermen, doctors, and more!', category: 'History', emoji: '📜' },
  { fact: 'The shortest verse in the Bible is John 11:35 — "Jesus wept." Just two words, but full of deep compassion and love.', category: 'Language', emoji: '😢' },
  { fact: 'The longest chapter in the Bible is Psalm 119 with 176 verses, and every section is dedicated to a letter of the Hebrew alphabet!', category: 'Numbers', emoji: '📖' },
  { fact: 'The word "love" appears 310 times in the NIV Bible. God really wants us to know how much He loves us!', category: 'Language', emoji: '❤️' },
  { fact: 'Methuselah is the oldest person mentioned in the Bible — he lived to be 969 years old! (Genesis 5:27)', category: 'People', emoji: '👴' },
  { fact: 'The Bible has been translated into over 700 languages, with portions translated into over 3,500 languages worldwide!', category: 'History', emoji: '🌍' },
  { fact: 'King Solomon was said to have written 3,000 proverbs and 1,005 songs during his lifetime! (1 Kings 4:32)', category: 'People', emoji: '👑' },
  { fact: 'The word "Trinity" never actually appears in the Bible, yet the concept of Father, Son, and Holy Spirit is found throughout Scripture.', category: 'Language', emoji: '✝️' },
  { fact: 'The Dead Sea Scrolls, discovered in 1947, contained copies of every Old Testament book except Esther, dating back over 2,000 years!', category: 'History', emoji: '📜' },
  { fact: 'Goliath was approximately 9 feet 9 inches tall (about 3 meters). David defeated him with just a sling and a stone!', category: 'People', emoji: '🪨' },
  { fact: 'The Bible contains 66 books — 39 in the Old Testament and 27 in the New Testament.', category: 'Numbers', emoji: '📚' },
  { fact: 'Noah\'s Ark was approximately 450 feet long, 75 feet wide, and 45 feet high — that\'s about 1.5 football fields long!', category: 'Numbers', emoji: '🚢' },
  { fact: 'The book of Esther and the Song of Solomon are the only two books in the Bible that don\'t directly mention God by name.', category: 'Language', emoji: '🤔' },
  { fact: 'Jesus walked on water, but did you know Peter did too? He walked on water toward Jesus before he got scared and began to sink! (Matthew 14:29)', category: 'People', emoji: '🌊' },
  { fact: 'The walls of Jericho fell after the Israelites marched around them for 7 days — an ancient city conquered by a worship march!', category: 'History', emoji: '🎺' },
  { fact: 'The Garden of Eden is believed to have been located near modern-day Iraq, between the Tigris and Euphrates rivers.', category: 'Geography', emoji: '🌳' },
  { fact: 'There are 8 people named Jesus in the Bible! The name "Yeshua" (Jesus) was actually a common Hebrew name meaning "God saves."', category: 'People', emoji: '✨' },
  { fact: 'The first English translation of the entire Bible was by John Wycliffe in 1382, which was hand-written since the printing press hadn\'t been invented yet!', category: 'History', emoji: '✍️' },
  { fact: 'Psalm 117 is the shortest chapter in the Bible with only 2 verses, while Psalm 118:8 is said to be the exact middle verse of the Bible!', category: 'Numbers', emoji: '🎯' },
  { fact: 'Moses spent 40 days on Mount Sinai, the Israelites wandered 40 years in the desert, and Jesus fasted for 40 days. The number 40 symbolizes a period of testing!', category: 'Numbers', emoji: '4️⃣' },
  { fact: 'The first four books of the New Testament (Matthew, Mark, Luke, John) were written by an apostle, a missionary companion, a doctor, and a fisherman!', category: 'People', emoji: '📝' },
  { fact: 'Solomon\'s temple took 7 years to build and used over 180,000 laborers. The stones were cut and prepared offsite so that no hammer or chisel was heard during construction!', category: 'History', emoji: '🏛️' },
  { fact: 'There are over 300 prophecies in the Old Testament about Jesus that were fulfilled in the New Testament — written hundreds of years before His birth!', category: 'Prophecy', emoji: '🔮' },
  { fact: 'The apostle Paul wrote 13 of the 27 New Testament books — nearly half! All while traveling, being shipwrecked, and even writing from prison.', category: 'People', emoji: '⛓️' },
  { fact: 'The oldest person to become a father in the Bible is Abraham, who was 100 years old when Isaac was born!', category: 'People', emoji: '👶' },
  { fact: 'The Bible mentions over 120 different animals, from lions and bears to behemoths and leviathans!', category: 'Numbers', emoji: '🦁' },
  { fact: 'Mount Ararat, where Noah\'s Ark is believed to have landed, is in modern-day Turkey and stands at 16,854 feet tall!', category: 'Geography', emoji: '⛰️' },
  { fact: 'The word "Christian" was first used in Antioch (modern-day Turkey) and appears only 3 times in the entire Bible! (Acts 11:26, Acts 26:28, 1 Peter 4:16)', category: 'Language', emoji: '🏷️' },
  { fact: 'Samson once defeated 1,000 Philistines using only the jawbone of a donkey as his weapon! (Judges 15:15)', category: 'People', emoji: '💪' },
  { fact: 'The Bible was the first major book printed on Gutenberg\'s printing press in 1455, revolutionizing how knowledge was shared with the world!', category: 'History', emoji: '🖨️' },
];

// Pending page — Bible trivia questions (instant load)
const PENDING_TRIVIA_QUESTIONS = [
  { question: 'How many books are in the Bible?', options: ['55', '66', '72', '39'], correct: 1, explanation: 'The Bible contains 66 books — 39 in the Old Testament and 27 in the New Testament!' },
  { question: 'Who built the Ark?', options: ['Moses', 'Abraham', 'Noah', 'David'], correct: 2, explanation: 'Noah built the Ark as God instructed him before the great flood (Genesis 6:14-22).' },
  { question: 'What was the first miracle Jesus performed?', options: ['Walking on water', 'Turning water into wine', 'Healing a blind man', 'Feeding 5,000'], correct: 1, explanation: 'Jesus turned water into wine at the wedding in Cana — His first recorded miracle (John 2:1-11)!' },
  { question: 'Who was swallowed by a great fish?', options: ['Peter', 'Jonah', 'Paul', 'Daniel'], correct: 1, explanation: 'Jonah was swallowed by a great fish after fleeing from God\'s command to preach to Nineveh (Jonah 1:17).' },
  { question: 'How many disciples did Jesus have?', options: ['10', '7', '12', '14'], correct: 2, explanation: 'Jesus chose 12 disciples (also called apostles) to follow Him and spread His teachings.' },
  { question: 'Who killed Goliath?', options: ['Saul', 'Jonathan', 'David', 'Samuel'], correct: 2, explanation: 'Young David defeated the giant Goliath with a sling and a single stone (1 Samuel 17)!' },
  { question: 'What is the first book of the Bible?', options: ['Exodus', 'Genesis', 'Psalms', 'Matthew'], correct: 1, explanation: 'Genesis means "beginning" — it tells the story of creation and the start of God\'s relationship with humanity.' },
  { question: 'Who parted the Red Sea?', options: ['Joshua', 'Moses', 'Elijah', 'Aaron'], correct: 1, explanation: 'God parted the Red Sea through Moses, allowing the Israelites to escape from Egypt (Exodus 14:21).' },
  { question: 'How many days did God take to create the world?', options: ['5', '6', '7', '3'], correct: 1, explanation: 'God created the world in 6 days and rested on the 7th day, making it holy (Genesis 2:2).' },
  { question: 'Who was the first king of Israel?', options: ['David', 'Solomon', 'Saul', 'Samuel'], correct: 2, explanation: 'Saul was anointed by Samuel as the first king of Israel (1 Samuel 10:1).' },
  { question: 'What did Jesus feed 5,000 people with?', options: ['7 loaves and 3 fish', '5 loaves and 2 fish', '3 loaves and 5 fish', '10 loaves and 10 fish'], correct: 1, explanation: 'Jesus miraculously fed 5,000 people with just 5 loaves of bread and 2 fish (Matthew 14:17-21)!' },
  { question: 'Who betrayed Jesus?', options: ['Peter', 'Thomas', 'Judas Iscariot', 'Andrew'], correct: 2, explanation: 'Judas Iscariot betrayed Jesus for 30 pieces of silver (Matthew 26:14-16).' },
  { question: 'What is the last book of the Bible?', options: ['Jude', 'Revelation', 'Malachi', 'Acts'], correct: 1, explanation: 'Revelation, written by the apostle John, describes visions of the end times and God\'s ultimate victory!' },
  { question: 'Where was Jesus born?', options: ['Nazareth', 'Jerusalem', 'Bethlehem', 'Capernaum'], correct: 2, explanation: 'Jesus was born in Bethlehem, fulfilling the prophecy in Micah 5:2!' },
  { question: 'Who wrote most of the Psalms?', options: ['Solomon', 'Moses', 'David', 'Samuel'], correct: 2, explanation: 'King David wrote about 73 of the 150 Psalms — he was known as the "sweet psalmist of Israel" (2 Samuel 23:1).' },
  { question: 'What was the name of Moses\' brother?', options: ['Joshua', 'Caleb', 'Aaron', 'Levi'], correct: 2, explanation: 'Aaron was Moses\' older brother who served as the first High Priest of Israel (Exodus 4:14).' },
  { question: 'How many plagues did God send on Egypt?', options: ['7', '10', '12', '5'], correct: 1, explanation: 'God sent 10 plagues on Egypt, from turning water to blood to the death of the firstborn (Exodus 7-12).' },
  { question: 'Who was thrown into the lion\'s den?', options: ['David', 'Daniel', 'Samson', 'Joseph'], correct: 1, explanation: 'Daniel was thrown into the lion\'s den for praying to God, but God shut the mouths of the lions! (Daniel 6:16-22)' },
  { question: 'What did God create on the first day?', options: ['Animals', 'Water', 'Light', 'Trees'], correct: 2, explanation: 'God said "Let there be light," and there was light — the very first thing He created (Genesis 1:3)!' },
  { question: 'Who was the strongest man in the Bible?', options: ['David', 'Goliath', 'Samson', 'Joshua'], correct: 2, explanation: 'Samson was given supernatural strength by God. He once killed a lion with his bare hands! (Judges 14:6)' },
  { question: 'What is the Golden Rule?', options: ['Love God above all', 'Do unto others as you would have them do unto you', 'Honor your father and mother', 'Keep the Sabbath holy'], correct: 1, explanation: 'Jesus taught: "Do to others what you would have them do to you" (Matthew 7:12).' },
  { question: 'Who was the first woman in the Bible?', options: ['Sarah', 'Eve', 'Ruth', 'Mary'], correct: 1, explanation: 'Eve was the first woman, created by God from Adam\'s rib in the Garden of Eden (Genesis 2:22).' },
  { question: 'How many days was Jonah inside the fish?', options: ['1 day', '3 days and 3 nights', '7 days', '40 days'], correct: 1, explanation: 'Jonah was inside the great fish for 3 days and 3 nights before being spit out on dry land (Jonah 1:17)!' },
  { question: 'What mountain did Moses receive the Ten Commandments on?', options: ['Mount Zion', 'Mount Ararat', 'Mount Sinai', 'Mount Carmel'], correct: 2, explanation: 'Moses received the Ten Commandments from God on Mount Sinai (Exodus 19-20).' },
  { question: 'Who was sold into slavery by his brothers?', options: ['Benjamin', 'Joseph', 'Reuben', 'Isaac'], correct: 1, explanation: 'Joseph was sold by his jealous brothers but rose to become second-in-command in all of Egypt! (Genesis 37:28)' },
  { question: 'What fruit is often associated with the Garden of Eden?', options: ['Fig', 'Pomegranate', 'Apple', 'Grape'], correct: 2, explanation: 'While the Bible says "fruit," tradition often depicts it as an apple. The actual type of fruit is never specified in Scripture!' },
  { question: 'Who was Paul\'s companion on his missionary journeys?', options: ['Peter', 'Barnabas', 'Timothy', 'Luke'], correct: 1, explanation: 'Barnabas was Paul\'s first major companion. Later, Silas, Timothy, and Luke also traveled with him.' },
  { question: 'How many of each animal did Moses take on the Ark?', options: ['2', '7', '1', 'None — it was Noah!'], correct: 3, explanation: 'Trick question! It was Noah who built the Ark, not Moses! Noah took animals on the Ark (Genesis 7:2).' },
  { question: 'What language was most of the Old Testament written in?', options: ['Greek', 'Latin', 'Hebrew', 'Aramaic'], correct: 2, explanation: 'The Old Testament was primarily written in Hebrew, with some portions in Aramaic.' },
  { question: 'Who walked on water with Jesus?', options: ['John', 'James', 'Peter', 'Andrew'], correct: 2, explanation: 'Peter walked on water toward Jesus, but began to sink when he took his eyes off Jesus (Matthew 14:29-30)!' },
];

// Bible book -> chapter count mapping
const BIBLE_BOOKS = {
  'Genesis':50,'Exodus':40,'Leviticus':27,'Numbers':36,'Deuteronomy':34,'Joshua':24,'Judges':21,'Ruth':4,
  '1 Samuel':31,'2 Samuel':24,'1 Kings':22,'2 Kings':25,'1 Chronicles':29,'2 Chronicles':36,'Ezra':10,
  'Nehemiah':13,'Esther':10,'Job':42,'Psalms':150,'Proverbs':31,'Ecclesiastes':12,'Song of Solomon':8,
  'Isaiah':66,'Jeremiah':52,'Lamentations':5,'Ezekiel':48,'Daniel':12,'Hosea':14,'Joel':3,'Amos':9,
  'Obadiah':1,'Jonah':4,'Micah':7,'Nahum':3,'Habakkuk':3,'Zephaniah':3,'Haggai':2,'Zechariah':14,'Malachi':4,
  'Matthew':28,'Mark':16,'Luke':24,'John':21,'Acts':28,'Romans':16,'1 Corinthians':16,'2 Corinthians':13,
  'Galatians':6,'Ephesians':6,'Philippians':4,'Colossians':4,'1 Thessalonians':5,'2 Thessalonians':3,
  '1 Timothy':6,'2 Timothy':4,'Titus':3,'Philemon':1,'Hebrews':13,'James':5,'1 Peter':5,'2 Peter':3,
  '1 John':5,'2 John':1,'3 John':1,'Jude':1,'Revelation':22,
};

// Verse count per chapter for each book (accurate per KJV canon)
const VERSES_PER_CHAPTER = {
  'Genesis':[31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26],
  'Exodus':[22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38],
  'Leviticus':[17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34],
  'Numbers':[54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13],
  'Deuteronomy':[46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12],
  'Joshua':[18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33],
  'Judges':[36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25],
  'Ruth':[22,23,18,22],
  '1 Samuel':[28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,43,15,23,28,18,34,40,44,13,22],
  '2 Samuel':[27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25],
  '1 Kings':[53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53],
  '2 Kings':[18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30],
  '1 Chronicles':[54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30],
  '2 Chronicles':[17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23],
  'Ezra':[11,70,13,24,17,22,28,36,15,44],
  'Nehemiah':[11,20,32,23,19,19,73,18,38,39,36,47,31],
  'Esther':[22,23,15,17,14,14,10,17,32,3],
  'Job':[22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17],
  'Psalms':[6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6],
  'Proverbs':[33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31],
  'Ecclesiastes':[18,26,22,16,20,12,29,17,18,20,10,14],
  'Song of Solomon':[17,17,11,16,16,13,13,14],
  'Isaiah':[31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24],
  'Jeremiah':[19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34],
  'Lamentations':[22,22,66,22,22],
  'Ezekiel':[28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35],
  'Daniel':[21,49,30,37,31,28,28,27,27,21,45,13],
  'Hosea':[11,23,5,19,15,11,16,14,17,15,12,14,16,9],
  'Joel':[20,32,21],
  'Amos':[15,16,15,13,27,14,17,14,15],
  'Obadiah':[21],
  'Jonah':[17,10,10,11],
  'Micah':[16,13,12,13,15,16,20],
  'Nahum':[15,13,19],
  'Habakkuk':[17,20,19],
  'Zephaniah':[18,15,20],
  'Haggai':[15,23],
  'Zechariah':[21,13,10,14,11,15,14,23,17,12,17,14,9,21],
  'Malachi':[14,17,18,6],
  'Matthew':[25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  'Mark':[45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  'Luke':[80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  'John':[51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  'Acts':[26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  'Romans':[32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  '1 Corinthians':[31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,10],
  '2 Corinthians':[24,17,18,18,21,18,16,24,15,18,33,21,14],
  'Galatians':[24,21,29,31,26,18],
  'Ephesians':[23,22,21,32,33,24],
  'Philippians':[30,30,21,23],
  'Colossians':[29,23,25,18],
  '1 Thessalonians':[10,20,13,18,28],
  '2 Thessalonians':[12,17,18],
  '1 Timothy':[20,15,16,16,25,21],
  '2 Timothy':[18,26,17,22],
  'Titus':[16,15,15],
  'Philemon':[25],
  'Hebrews':[14,18,19,16,14,20,28,13,28,39,40,29,25],
  'James':[27,26,18,17,20],
  '1 Peter':[25,25,22,19,14],
  '2 Peter':[21,22,18],
  '1 John':[10,29,24,21,21],
  '2 John':[13],
  '3 John':[14],
  'Jude':[25],
  'Revelation':[20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21],
};

// Simple markdown renderer for Bible answers
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let key = 0;
  for (let line of lines) {
    // Bold: **text**
    let processed = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text*
    processed = processed.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    if (line.startsWith('### ')) {
      elements.push(<h4 key={key++} className="bible-ans-heading" dangerouslySetInnerHTML={{ __html: processed.slice(4) }} />);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={key++} className="bible-ans-heading" dangerouslySetInnerHTML={{ __html: processed.slice(3) }} />);
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(<div key={key++} className="bible-ans-list-item" dangerouslySetInnerHTML={{ __html: processed }} />);
    } else if (line.trim() === '') {
      elements.push(<div key={key++} style={{ height: 8 }} />);
    } else {
      elements.push(<p key={key++} className="bible-ans-para" dangerouslySetInnerHTML={{ __html: processed }} />);
    }
  }
  return elements;
}

const PASTORS = [
  { name: 'Dr. Weldon Pior', title: 'Senior Pastor', photo: '/assets/dr-weldon-pior.png' },
  { name: 'Dr. Dorothy Pior', title: 'Senior Pastor', photo: '/assets/dr-dorothy-pior.png' },
  { name: 'Ptr. Gracelyn Gambe', title: 'Associate Pastor', photo: '/assets/ptr-gracelyn-gambe.png' },
  { name: 'Ptr. Eldan Gambe', title: 'Associate Pastor', photo: '/assets/ptr-eldan-gambe.png' },
  { name: 'Ptr. Psalm Gambe', title: 'Youth Pastor', photo: '/assets/ptr-psalm-gambe.png' },
];

const GATHERINGS = [
  { title: 'Sunday Worship Service', desc: 'Our church family united in powerful worship and biblical teaching every Sunday', photo: '/assets/worship-service.jpg' },
  { title: 'Pastor Appreciation', desc: 'Honoring and celebrating our dedicated pastors for their faithful service and leadership', photo: '/assets/pastor-appreciation.jpg' },
  { title: 'Youth Ministry Event', desc: 'Dynamic youth gatherings filled with fun, fellowship, and spiritual growth', photo: '/assets/youth-event.jpg' },
  { title: 'Community Outreach', desc: 'Extending God\'s love through practical service and evangelism in our community', photo: '/assets/community-outreach.jpg' },
  { title: 'Christian Leadership Conference', desc: 'Equipping and empowering leaders for effective ministry and spiritual guidance', photo: '/assets/christian-leadership-conference.jpg' },
  { title: 'Baptism Service', desc: 'Powerful moments of public declaration of faith through water baptism', photo: '/assets/baptism-service.jpg' },
  { title: 'Friday Bible Study', desc: 'In-depth Bible study and discussion for spiritual growth and deeper understanding', photo: '/assets/friday-bible-study.jpg' },
  { title: 'ISOM', desc: 'International School of Ministry training for leadership development and ministry equipping', photo: '/assets/isom-training.jpg' },
];

// ============================================
// DASHBOARD COMPONENT
// ============================================
export default function DashboardPage() {
  const router = useRouter();

  // Core state
  const [userData, setUserData] = useState(null);
  const [userRole, setUserRole] = useState('Guest');
  const [activeSection, setActiveSection] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Pastors carousel
  const [pastorCarouselIndex, setPastorCarouselIndex] = useState(0);

  // Bible verse
  const [dailyVerse, setDailyVerse] = useState({ verse: 'Loading verse of the day...', reference: 'Loading...', explanation: '' });
  const [bibleVersion, setBibleVersion] = useState('NIV');

  // Schedules
  const [scheduleData, setScheduleData] = useState([]);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedSchedule, setSelectedSchedule] = useState(null);

  // Create Lineup
  const [lineupForm, setLineupForm] = useState({
    scheduleDate: '', practiceDate: '', practiceTime: '', songLeader: '',
    backupSingers: [], slowSongs: [{ title: '', link: '', instructions: '' }],
    fastSongs: [{ title: '', link: '', instructions: '' }],
  });
  const [lineupLoading, setLineupLoading] = useState(false);
  const [lineupView, setLineupView] = useState('calendar'); // 'calendar' | 'form' | 'success'
  const [lineupSelectedDate, setLineupSelectedDate] = useState(null);
  const [lineupCalendarMonth, setLineupCalendarMonth] = useState(new Date());
  const [lineupTab, setLineupTab] = useState('assign'); // 'assign' | 'all' | 'paw-logs'

  // PAW Logs
  const [pawLogsSearch, setPawLogsSearch] = useState('');
  const [pawLogsFilter, setPawLogsFilter] = useState('All'); // 'All' | 'Pending' | 'Approved' | 'Rejected'
  const [pawLogsRoleFilter, setPawLogsRoleFilter] = useState('All'); // 'All' | 'Song Leader' | 'Backup Singer' | 'Instrumentalist' | 'Dancer' | 'Media'
  const [pawAllMembers, setPawAllMembers] = useState([]); // All PAW ministry members with profile pics

  // AI Song Scanner
  // Key format: "slowSongs-0", "fastSongs-1", etc.
  // Value: { status: 'scanning'|'safe'|'explicit'|'warning'|'error', message: string, details: string }
  const [songScanResults, setSongScanResults] = useState({});
  const songScanTimers = useRef({});
  const [songAutoFillLoading, setSongAutoFillLoading] = useState({}); // { 'slowSongs-0': true } when auto-filling title from YT

  // My Lineups
  const [myLineups, setMyLineups] = useState([]);
  const [editingLineup, setEditingLineup] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Backup Singers (fetched from DB)
  const [backupSingerOptions, setBackupSingerOptions] = useState([]);

  // Song Leader options (for admin to pick from)
  const [songLeaderOptions, setSongLeaderOptions] = useState([]);

  // Detail popup for Song Leader viewing other dates
  const [lineupDetailPopup, setLineupDetailPopup] = useState(null); // { songLeader, backupSingers, date }
  const [lineupViewingAssignment, setLineupViewingAssignment] = useState(null); // for viewing assignment details in All Assignments

  // Lineup Excuses
  const [lineupExcuses, setLineupExcuses] = useState([]); // all excuses loaded
  const [excuseModalDate, setExcuseModalDate] = useState(null); // date being excused
  const [excuseModalRoleType, setExcuseModalRoleType] = useState(null); // role type override for excuse
  const [excuseReason, setExcuseReason] = useState('');
  const [excuseLoading, setExcuseLoading] = useState(false);

  // Lineup Substitutes
  const [subRequests, setSubRequests] = useState([]);
  const [subModalDate, setSubModalDate] = useState(null); // date for sub request modal
  const [subModalScheduleId, setSubModalScheduleId] = useState(null);
  const [subModalRoleType, setSubModalRoleType] = useState(null); // role type for sub request
  const [subReason, setSubReason] = useState('');
  const [subLoading, setSubLoading] = useState(false);
  const [subThankYouModal, setSubThankYouModal] = useState(null); // { subId, subName }
  const [subThankYouMessage, setSubThankYouMessage] = useState('');
  const [pawLogsSubTab, setPawLogsSubTab] = useState('excuses'); // 'excuses' | 'substitutes' (admin PAW Logs)
  const [pawActionCalMonth, setPawActionCalMonth] = useState(new Date()); // calendar month for PAW quick actions
  const [pawActionModal, setPawActionModal] = useState(null); // { date, roleType } — the date-action picker modal

  // Profile
  const [profileTab, setProfileTab] = useState('personal');
  const [profileForm, setProfileForm] = useState({ firstname: '', lastname: '', birthdate: '', life_verse: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [setPasswordFormData, setSetPasswordFormData] = useState({ newPassword: '', confirmPassword: '' });
  const [hasLocalPassword, setHasLocalPassword] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // Profile Picture Upload/Crop
  const [showCropModal, setShowCropModal] = useState(false);
  const [closingCropModal, setClosingCropModal] = useState(false);
  const [cropImage, setCropImage] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const profilePicInputRef = useRef(null);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [viewProfilePic, setViewProfilePic] = useState(false);
  const avatarMenuRef = useRef(null);
  const avatarWrapperRef = useRef(null);

  // Password visibility toggles
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSetNewPassword, setShowSetNewPassword] = useState(false);
  const [showSetConfirmPassword, setShowSetConfirmPassword] = useState(false);

  // Life Verse Banner
  const [lifeVerseFullText, setLifeVerseFullText] = useState('');
  const [lifeVerseRef, setLifeVerseRef] = useState('');
  const [lifeVerseVersion, setLifeVerseVersion] = useState('NIV');
  const [lifeVerseLoading, setLifeVerseLoading] = useState(false);

  // Bible Reader
  const [bibleBook, setBibleBook] = useState('Genesis');
  const [bibleChapter, setBibleChapter] = useState(1);
  const [bibleVerse, setBibleVerse] = useState('');
  const [bibleText, setBibleText] = useState('');
  const [bibleQuestion, setBibleQuestion] = useState('');
  const [bibleAnswer, setBibleAnswer] = useState('');
  const [highlightPopup, setHighlightPopup] = useState({ visible: false, x: 0, y: 0, text: '' });
  const [directScripture, setDirectScripture] = useState('');
  const [answerCopied, setAnswerCopied] = useState(false);
  const bibleTextRef = useRef(null);

  // Daily Quote
  const [dailyQuote, setDailyQuote] = useState({ quote: 'Loading...', author: '' });

  // Spiritual Assistant
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMemoryLoaded, setChatMemoryLoaded] = useState(false);
  const chatEndRef = useRef(null);

  // Birthdays
  const [birthdayData, setBirthdayData] = useState([]);

  // Events
  const [events, setEvents] = useState([]);
  const [eventForm, setEventForm] = useState({ title: '', description: '', eventDate: '', endDate: '', location: '' });
  const [showEventForm, setShowEventForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);

  // User-Created Events (enabled by admin)
  const [userEvents, setUserEvents] = useState([]);
  const [userEventForm, setUserEventForm] = useState({ title: '', description: '', eventType: 'Event', eventDate: '', endDate: '', location: '' });
  const [showUserEventForm, setShowUserEventForm] = useState(false);
  const [editingUserEvent, setEditingUserEvent] = useState(null);
  const [userEventRsvps, setUserEventRsvps] = useState(null); // { data, grouped, counts }
  const [viewingUserEventRsvps, setViewingUserEventRsvps] = useState(null); // event object
  const [allUserEventsForPastor, setAllUserEventsForPastor] = useState([]);
  const [pastorViewingEvent, setPastorViewingEvent] = useState(null);
  const [pastorEventRsvps, setPastorEventRsvps] = useState(null);
  const [eventPermissionsUser, setEventPermissionsUser] = useState(null); // user being edited for event perms
  const [eventPermissionsForm, setEventPermissionsForm] = useState([]); // array of selected types
  const [browseUserEvents, setBrowseUserEvents] = useState([]); // all user events (for browsing/RSVP)
  const [myEventsTab, setMyEventsTab] = useState('mine'); // 'mine' or 'browse'

  // Announcements
  const [announcements, setAnnouncements] = useState([]);
  const [announcementForm, setAnnouncementForm] = useState({ title: '', content: '', isPinned: false });
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);

  // Meetings
  const [meetings, setMeetings] = useState([]);
  const [meetingForm, setMeetingForm] = useState({ title: '', description: '', meetingDate: '', location: '' });
  const [showMeetingForm, setShowMeetingForm] = useState(false);

  // Community Hub
  const [communityPosts, setCommunityPosts] = useState([]);
  const [newPostContent, setNewPostContent] = useState('');
  const [commentInputs, setCommentInputs] = useState({});
  const [postComments, setPostComments] = useState({});
  const [showComments, setShowComments] = useState({});
  const [editingPost, setEditingPost] = useState(null);
  const [editPostContent, setEditPostContent] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [editCommentContent, setEditCommentContent] = useState('');
  const [commentLikeAnimating, setCommentLikeAnimating] = useState({});
  const [viewingProfile, setViewingProfile] = useState(null);
  const [postMenuOpen, setPostMenuOpen] = useState(null);
  const [commentMenuOpen, setCommentMenuOpen] = useState(null);
  // Bible Verse Share
  const [showVerseShareModal, setShowVerseShareModal] = useState(false);
  const [verseShareRef, setVerseShareRef] = useState('');
  const [verseShareText, setVerseShareText] = useState('');
  const [verseShareReflection, setVerseShareReflection] = useState('');
  const [verseShareLoading, setVerseShareLoading] = useState(false);
  const [viewedPosts, setViewedPosts] = useState(() => { try { return JSON.parse(localStorage.getItem('viewedPosts') || '[]'); } catch { return []; } });

  // Messages
  const [messages, setMessages] = useState([]);
  const [messageTab, setMessageTab] = useState('inbox');
  const [messageForm, setMessageForm] = useState({ receiverId: '', subject: '', content: '', isBroadcast: false, broadcastTarget: 'all' });
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [allUsers, setAllUsers] = useState([]);

  // Attendance
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]);

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Reports
  const [reportData, setReportData] = useState(null);

  // Admin: Users Management
  const [adminUsers, setAdminUsers] = useState([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userForm, setUserForm] = useState({ firstname: '', lastname: '', email: '', password: '', ministry: '', sub_role: '', role: 'Guest' });
  const [editingUser, setEditingUser] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userFilterRole, setUserFilterRole] = useState('');
  const [userFilterMinistry, setUserFilterMinistry] = useState('');
  const [userFilterStatus, setUserFilterStatus] = useState('');
  const [userActionMenu, setUserActionMenu] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [showResetPwModal, setShowResetPwModal] = useState(null);
  const [resetPwForm, setResetPwForm] = useState({ newPassword: '', confirmPassword: '' });
  const [showResetPw, setShowResetPw] = useState({ new: false, confirm: false });
  const [newSubRoleInput, setNewSubRoleInput] = useState('');

  // Admin: Ministry Management
  const [ministriesList, setMinistriesList] = useState([]);
  const [ministryForm, setMinistryForm] = useState({ name: '', description: '' });
  const [showMinistryForm, setShowMinistryForm] = useState(false);

  // Super Admin: Roles
  const [rolesList, setRolesList] = useState([]);

  // Super Admin: Audit Logs
  const [auditLogs, setAuditLogs] = useState([]);

  // Super Admin: System Settings
  const [systemSettings, setSystemSettings] = useState({});

  // Super Admin: Terms & Conditions Editor
  const [termsContent, setTermsContent] = useState('');
  const [termsLoading, setTermsLoading] = useState(false);
  const [termsSaving, setTermsSaving] = useState(false);
  const [termsLastUpdated, setTermsLastUpdated] = useState('');

  // Super Admin: Permissions Control (real-time)
  const [permissionOverrides, setPermissionOverrides] = useState({});
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permCtrlLoading, setPermCtrlLoading] = useState(false);
  const [permCtrlRole, setPermCtrlRole] = useState('Guest');
  const [permCtrlSearch, setPermCtrlSearch] = useState('');
  const [permCtrlCategory, setPermCtrlCategory] = useState('All');
  const [permCtrlSaving, setPermCtrlSaving] = useState({});
  const [permCtrlUnlocked, setPermCtrlUnlocked] = useState(false);
  const [permCtrlPasswordInput, setPermCtrlPasswordInput] = useState('');
  const [permCtrlPasswordError, setPermCtrlPasswordError] = useState('');
  const [permCtrlVerifying, setPermCtrlVerifying] = useState(false);
  const [permCtrlConfirmModal, setPermCtrlConfirmModal] = useState(null); // { action, title, message, onConfirm }
  const [permCtrlExpandedCats, setPermCtrlExpandedCats] = useState({});

  // Admin Access Password (set in My Profile)
  const [adminAccessPassword, setAdminAccessPassword] = useState('');
  const [adminAccessPasswordConfirm, setAdminAccessPasswordConfirm] = useState('');
  const [hasAdminAccessPassword, setHasAdminAccessPassword] = useState(false);
  const [adminPasswordSaving, setAdminPasswordSaving] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [showAdminPasswordConfirm, setShowAdminPasswordConfirm] = useState(false);

  // Praise & Worship
  const [pawSchedules, setPawSchedules] = useState([]);
  const [pawMySchedules, setPawMySchedules] = useState([]);
  const [pawNotifications, setPawNotifications] = useState([]);
  const [pawBibleVerse, setPawBibleVerse] = useState(null);
  const [pawBibleVerseLoading, setPawBibleVerseLoading] = useState(false);
  const [pawSelectedSchedule, setPawSelectedSchedule] = useState(null);
  const [pawTab, setPawTab] = useState('schedules'); // 'schedules' | 'my-schedule' | 'notifications'
  const [pawLyricsModal, setPawLyricsModal] = useState(null); // { title, lyrics, artist, thumbnail, loading }
  const [pawPlayingSong, setPawPlayingSong] = useState(null); // { key: 'slow-0', videoId: 'abc' } or null
  const [pawAudioTime, setPawAudioTime] = useState({ current: 0, duration: 0 });
  const pawPlayerRef = useRef(null);
  const pawProgressRef = useRef(null);

  // Multimedia Lyrics Library
  const [lyricsLibrary, setLyricsLibrary] = useState([]);
  const [lyricsSearch, setLyricsSearch] = useState('');
  const [lyricsLangFilter, setLyricsLangFilter] = useState('All');
  const [lyricsEditorOpen, setLyricsEditorOpen] = useState(false);
  const [lyricsEditorData, setLyricsEditorData] = useState(null); // null = new, object = editing
  const [lyricsEditorForm, setLyricsEditorForm] = useState({ title: '', artist: '', language: 'English', youtube_link: '', sections: [], lyrics_plain: '', lyrics_html: '' });
  const [lyricsEditorLoading, setLyricsEditorLoading] = useState(false);
  const [lyricsAiLoading, setLyricsAiLoading] = useState(false);
  const [lyricsFormatLoading, setLyricsFormatLoading] = useState(false);
  const [lyricsPasteText, setLyricsPasteText] = useState('');
  const [lyricsLinkModal, setLyricsLinkModal] = useState(null); // { lyricsId, lyricsTitle } for linking to schedule
  const [multimediaLineupNotifs, setMultimediaLineupNotifs] = useState([]); // schedules needing lyrics

  // Facebook Live Streams
  const [liveStreams, setLiveStreams] = useState([]);
  const [liveStreamForm, setLiveStreamForm] = useState({ iframe_url: '', caption: 'Sunday Service Live', title: 'Sunday Service Live' });
  const [showLiveStreamForm, setShowLiveStreamForm] = useState(false);
  const [editingLiveStream, setEditingLiveStream] = useState(null);
  const [liveStreamLoading, setLiveStreamLoading] = useState(false);
  const [activeLiveStream, setActiveLiveStream] = useState(null); // currently viewed live in community
  const [liveStreamComments, setLiveStreamComments] = useState([]);
  const [liveStreamCommentInput, setLiveStreamCommentInput] = useState('');
  const [liveStreamReactionCount, setLiveStreamReactionCount] = useState(0);
  const [liveStreamUserReacted, setLiveStreamUserReacted] = useState(false);
  const [liveStreamReactAnimating, setLiveStreamReactAnimating] = useState(false);
  const [liveStreamFullscreen, setLiveStreamFullscreen] = useState(false);
  const [liveStreamCommentsVisible, setLiveStreamCommentsVisible] = useState(true);
  const [liveStreamReplyTo, setLiveStreamReplyTo] = useState(null); // { id, user_name }
  const [liveStreamCommentLikeAnimating, setLiveStreamCommentLikeAnimating] = useState({});
  const [liveStreamFloatingHearts, setLiveStreamFloatingHearts] = useState([]);
  const liveStreamFullscreenRef = useRef(null);
  const [showLiveShareModal, setShowLiveShareModal] = useState(false);
  const [liveShareCopied, setLiveShareCopied] = useState(false);

  // Logout
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Welcome Modal (for new users)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [welcomeVerse, setWelcomeVerse] = useState({ verse: '', reference: '' });

  // Account Deleted Detection
  const [accountDeleted, setAccountDeleted] = useState(false);

  // Pending Page States
  const [pendingAiVerse, setPendingAiVerse] = useState(() => PENDING_ENCOURAGEMENT_VERSES[Math.floor(Math.random() * PENDING_ENCOURAGEMENT_VERSES.length)]);
  const [pendingLifeVerseFeedback, setPendingLifeVerseFeedback] = useState('');
  const [pendingLifeVerseFeedbackLoading, setPendingLifeVerseFeedbackLoading] = useState(false);
  const [pendingSetupSaving, setPendingSetupSaving] = useState(false);
  const [pendingSetupDone, setPendingSetupDone] = useState(false);
  const [pendingFunFact, setPendingFunFact] = useState(() => PENDING_BIBLE_FACTS[Math.floor(Math.random() * PENDING_BIBLE_FACTS.length)]);
  const [pendingFactIndex, setPendingFactIndex] = useState(0);
  const [pendingGameActive, setPendingGameActive] = useState(true);
  const [pendingGameQuestion, setPendingGameQuestion] = useState(() => PENDING_TRIVIA_QUESTIONS[Math.floor(Math.random() * PENDING_TRIVIA_QUESTIONS.length)]);
  const [pendingGameAnswer, setPendingGameAnswer] = useState('');
  const [pendingGameResult, setPendingGameResult] = useState(null);
  const [pendingGameScore, setPendingGameScore] = useState({ correct: 0, total: 0 });
  const [pendingTriviaUsed, setPendingTriviaUsed] = useState([]);
  const [pendingBirthdate, setPendingBirthdate] = useState('');
  const [pendingLifeVerse, setPendingLifeVerse] = useState('');

  // ============================================
  // INITIALIZATION
  // ============================================
  useEffect(() => {
    const stored = JSON.parse(sessionStorage.getItem('userData') || localStorage.getItem('userData') || '{}');
    if (!stored || !stored.firstname) {
      router.replace('/login');
      return;
    }
    setUserData(stored);
    setUserRole(stored.role || 'Guest');
    setIsVerified(stored.status === 'Verified');
    setProfileForm({ firstname: stored.firstname, lastname: stored.lastname, birthdate: stored.birthdate || '', life_verse: stored.life_verse || '' });
    setHasLocalPassword(stored.hasPassword !== false);
    setPendingBirthdate(stored.birthdate || '');
    setPendingLifeVerse(stored.life_verse || '');
    if (stored.birthdate && stored.life_verse) setPendingSetupDone(true);

    const savedDark = localStorage.getItem('darkModeEnabled') === 'true';
    setDarkMode(savedDark);
    if (savedDark) {
      document.body.classList.add('dark-mode');
      document.documentElement.classList.add('dark-mode');
    }

    // Load saved Bible version preference
    const savedVersion = localStorage.getItem('bibleVersionPref');
    if (savedVersion) setBibleVersion(savedVersion);

    // Load saved life verse version preference
    const savedLifeVerseVer = localStorage.getItem('lifeVerseVersionPref');
    if (savedLifeVerseVer) setLifeVerseVersion(savedLifeVerseVer);

    // Load chat memory for this user
    try {
      const chatKey = `chatMemory_${stored.email || stored.id}`;
      const savedChat = localStorage.getItem(chatKey);
      if (savedChat) {
        const parsed = JSON.parse(savedChat);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChatMessages(parsed);
        }
      }
    } catch { /* silent */ }
    setChatMemoryLoaded(true);

    // Welcome modal for new/first-time users
    const welcomeKey = `welcomed_${stored.email || stored.id}`;
    if (!localStorage.getItem(welcomeKey)) {
      const WELCOME_VERSES = [
        { verse: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.', reference: 'Jeremiah 29:11' },
        { verse: 'The Lord bless you and keep you; the Lord make his face shine on you and be gracious to you; the Lord turn his face toward you and give you peace.', reference: 'Numbers 6:24-26' },
        { verse: 'Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!', reference: '2 Corinthians 5:17' },
        { verse: 'Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.', reference: 'Proverbs 3:5-6' },
        { verse: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.', reference: 'Joshua 1:9' },
        { verse: 'I can do all this through him who gives me strength.', reference: 'Philippians 4:13' },
        { verse: 'Come to me, all you who are weary and burdened, and I will give you rest.', reference: 'Matthew 11:28' },
        { verse: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.', reference: 'Isaiah 40:31' },
        { verse: 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.', reference: 'Romans 8:28' },
        { verse: 'The Lord is my shepherd, I lack nothing. He makes me lie down in green pastures, he leads me beside quiet waters, he refreshes my soul.', reference: 'Psalm 23:1-3' },
      ];
      const randomVerse = WELCOME_VERSES[Math.floor(Math.random() * WELCOME_VERSES.length)];
      setWelcomeVerse(randomVerse);
      setShowWelcomeModal(true);
    }

    fetchDailyVerse(stored.ministry);
    loadScheduleData();
    loadBirthdays();
    if (stored.id) loadNotifications(stored.id);

    // Fetch life verse full text for banner
    if (stored.life_verse) {
      const lv = savedLifeVerseVer || 'NIV';
      // Defer to avoid blocking init
      setTimeout(() => fetchLifeVerse(stored.life_verse, lv), 500);
    }

    // Refresh allowed_event_types from server (in case admin changed permissions)
    if (stored.id) {
      fetch(`/api/admin/users?action=get-event-permissions&userId=${stored.id}`)
        .then(r => r.json())
        .then(result => {
          if (result.success) {
            const updatedTypes = result.allowed_event_types || [];
            const current = stored.allowed_event_types || [];
            if (JSON.stringify(updatedTypes) !== JSON.stringify(current)) {
              const updated = { ...stored, allowed_event_types: updatedTypes };
              setUserData(updated);
              sessionStorage.setItem('userData', JSON.stringify(updated));
              localStorage.setItem('userData', JSON.stringify(updated));
            }
          }
        })
        .catch(() => { /* silent - use cached data */ });
    }

    // Load permission overrides & subscribe to real-time changes
    loadPermissionOverrides();
    // Check admin access password status for admin/super admin
    if (['Admin', 'Super Admin'].includes(stored.role)) {
      checkAdminAccessPassword();
    }
    let permChannel;
    if (supabase) {
      permChannel = supabase
        .channel('role-permissions-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'role_permissions_control' }, (payload) => {
          // Real-time update: re-fetch all overrides
          loadPermissionOverrides();
        })
        .subscribe();
    }
    return () => {
      if (permChannel) supabase.removeChannel(permChannel);
    };
  }, [router]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Persist chat memory to localStorage
  useEffect(() => {
    if (!chatMemoryLoaded || !userData?.email) return;
    const chatKey = `chatMemory_${userData.email || userData.id}`;
    if (chatMessages.length > 0) {
      // Keep last 50 messages to avoid localStorage overflow
      const toSave = chatMessages.slice(-50);
      localStorage.setItem(chatKey, JSON.stringify(toSave));
    }
  }, [chatMessages, chatMemoryLoaded, userData]);

  // ============================================
  // REAL-TIME USER RECORD SYNC
  // Detects admin changes (role, ministry, verification, etc.)
  // and account deletion — all in real-time, no refresh needed
  // ============================================
  useEffect(() => {
    if (!userData?.id || !supabase) return;
    const userId = userData.id;

    const userChannel = supabase
      .channel(`user-record-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${userId}`,
      }, (payload) => {
        const updated = payload.new;
        if (!updated) return;

        // Build merged userData object
        setUserData((prev) => {
          const merged = { ...prev, ...updated };
          // Persist to storage so page refresh also picks up changes
          sessionStorage.setItem('userData', JSON.stringify(merged));
          localStorage.setItem('userData', JSON.stringify(merged));
          return merged;
        });

        // Sync derived state that the dashboard relies on
        if (updated.role !== undefined) {
          setUserRole(updated.role || 'Guest');
          // Re-check admin access password if promoted to admin
          if (['Admin', 'Super Admin'].includes(updated.role)) {
            checkAdminAccessPassword();
          }
        }
        if (updated.status !== undefined) {
          setIsVerified(updated.status === 'Verified');
        }
        if (updated.firstname !== undefined || updated.lastname !== undefined || updated.birthdate !== undefined || updated.life_verse !== undefined) {
          setProfileForm((prev) => ({
            ...prev,
            ...(updated.firstname !== undefined && { firstname: updated.firstname }),
            ...(updated.lastname !== undefined && { lastname: updated.lastname }),
            ...(updated.birthdate !== undefined && { birthdate: updated.birthdate || '' }),
            ...(updated.life_verse !== undefined && { life_verse: updated.life_verse || '' }),
          }));
        }
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${userId}`,
      }, () => {
        // Account was deleted by admin
        setAccountDeleted(true);
        sessionStorage.removeItem('userData');
        localStorage.removeItem('userData');
      })
      .subscribe();

    return () => {
      supabase.removeChannel(userChannel);
    };
  }, [userData?.id]);

  // ============================================
  // REAL-TIME: SUBSTITUTE REQUESTS, NOTIFICATIONS, EXCUSES
  // Instantly updates when admin approves/rejects subs,
  // shows notification popup to backup singers, etc.
  // ============================================
  useEffect(() => {
    if (!userData?.id || !supabase) return;
    const userId = userData.id;

    // --- Real-time: lineup_substitutes ---
    const subsChannel = supabase
      .channel('lineup-substitutes-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'lineup_substitutes',
      }, (payload) => {
        // Re-fetch all sub requests on any change
        loadSubRequests();
        loadScheduleData();

        const evt = payload.eventType;
        const row = payload.new || {};

        // If a sub was just approved (Open for Sub) and I'm NOT the requester → toast
        if (evt === 'UPDATE' && row.status === 'Open for Sub' && row.requester_id !== userId) {
          const roleLabel = row.role_type || 'Song Leader';
          const userSubRole = userData?.sub_role || '';
          // Only show toast if the user's role matches the sub's role
          const myRole = userSubRole.includes('Song Leaders') ? 'Song Leader' : userSubRole.includes('Backup Singer') ? 'Backup Singer' : userSubRole.includes('Instrumentalist') ? 'Instrumentalist' : userSubRole.includes('Dancer') ? 'Dancer' : null;
          if (myRole && myRole === roleLabel) {
            showToast(`🔔 ${row.requester_name} (${roleLabel}) needs a substitute! Check the lineup section.`, 'info');
          }
        }

        // If MY sub was approved/rejected → toast
        if (evt === 'UPDATE' && row.requester_id === userId) {
          if (row.status === 'Open for Sub') {
            showToast('✅ Your substitute request was approved! Members have been notified.', 'success');
          } else if (row.status === 'Rejected') {
            showToast('❌ Your substitute request was rejected by admin.', 'danger');
          } else if (row.status === 'Accepted' && row.substitute_name) {
            showToast(`🎉 ${row.substitute_name} accepted your sub request!`, 'success');
          }
        }

        // If I just accepted someone's sub → toast for requester handled above
        if (evt === 'UPDATE' && row.status === 'Accepted' && row.substitute_id === userId) {
          showToast(`✅ You're now substituting for ${row.requester_name}!`, 'success');
        }
      })
      .subscribe();

    // --- Real-time: notifications ---
    const notifsChannel = supabase
      .channel(`notifications-realtime-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const notif = payload.new;
        // Re-fetch to update the bell count + PAW Notifications tab
        loadNotifications(userId);
        loadPawNotifications();
        // Show a toast with the notification title
        if (notif && notif.title) {
          showToast(notif.title, 'info');
        }
      })
      .subscribe();

    // --- Real-time: lineup_excuses ---
    const excusesChannel = supabase
      .channel('lineup-excuses-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'lineup_excuses',
      }, (payload) => {
        loadLineupExcuses();

        const evt = payload.eventType;
        const row = payload.new || {};

        // If MY excuse was approved/rejected → toast
        if (evt === 'UPDATE' && row.user_id === userId) {
          if (row.status === 'Approved') {
            showToast('✅ Your excuse has been approved!', 'success');
          } else if (row.status === 'Rejected') {
            showToast('❌ Your excuse was rejected by admin.', 'danger');
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subsChannel);
      supabase.removeChannel(notifsChannel);
      supabase.removeChannel(excusesChannel);
    };
  }, [userData?.id]);

  // ============================================
  // TOAST
  // ============================================
  const showToast = useCallback((message, type = 'info') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  // ============================================
  // DARK MODE
  // ============================================
  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkModeEnabled', next);
    document.body.classList.toggle('dark-mode', next);
    document.documentElement.classList.toggle('dark-mode', next);
  };

  // ============================================
  // NAVIGATION
  // ============================================
  const showSection = (sectionId) => {
    const isGuestRole = userRole === 'Guest';
    if (!isVerified && !isGuestRole && sectionId !== 'home') {
      showToast('🔒 Please wait for account verification to access this feature', 'warning');
      return;
    }
    // Block navigation if the sidebar section is disabled by SuperAdmin
    // Checks both sidebar-level toggles AND action-level feature toggles
    if (sectionId !== 'home' && userRole !== ROLES.SUPER_ADMIN) {
      if (!isSidebarItemEnabled(userRole, sectionId, permissionOverrides)) {
        showToast('🚫 This feature has been disabled by the administrator', 'warning');
        return;
      }
    }
    setActiveSection(sectionId);
    setSidebarOpen(false);

    // Load data on section visit
    if (sectionId === 'daily-quote') fetchDailyQuote();
    if (sectionId === 'events' || sectionId === 'events-management') loadEvents();
    if (sectionId === 'announcements' || sectionId === 'announcements-management') loadAnnouncements();
    if (sectionId === 'ministry-meetings') loadMeetings();
    if (sectionId === 'community-hub') loadCommunityPosts();
    if (sectionId === 'community-hub') loadLiveStreams();
    if (sectionId === 'live-stream-management') loadLiveStreams();
    if (sectionId === 'messages') loadMessages();
    if (sectionId === 'attendance-management') loadAttendance();
    if (sectionId === 'reports') loadReports();
    if (sectionId === 'user-management') loadAdminUsers();
    if (sectionId === 'ministry-management' || sectionId === 'ministry-oversight') loadMinistries();
    if (sectionId === 'roles-permissions') loadRoles();
    if (sectionId === 'audit-logs') loadAuditLogs();
    if (sectionId === 'system-config') loadSystemSettings();
    if (sectionId === 'terms-conditions') loadTermsConditions();
    if (sectionId === 'permissions-control') { loadPermissionOverrides(); } else { setPermCtrlUnlocked(false); setPermCtrlPasswordInput(''); setPermCtrlPasswordError(''); }
    if (sectionId === 'create-lineup') { loadScheduleData(); loadLineupExcuses(); loadSubRequests(); loadPawMembers(); if (userRole === 'Admin' || userRole === 'Super Admin') { loadBackupSingers(); loadSongLeaders(); } }
    if (sectionId === 'my-lineups') loadScheduleData();
    if (sectionId === 'praise-worship') { loadPawSchedules(); loadPawMySchedules(); loadPawNotifications(); loadSubRequests(); loadLineupExcuses(); const subRole = userData?.sub_role || ''; const ministry = userData?.ministry || ''; let roleLabel = subRole || ministry || 'Worship Team Member'; fetchPawBibleVerse(roleLabel); if ((ministry === 'Media') || (subRole || '').includes('Multimedia') || (subRole || '').includes('Lyrics')) { loadLyricsLibrary(); loadMultimediaLineupNotifs(); } }
    if (sectionId === 'my-created-events') { loadUserEvents(); loadBrowseUserEvents(); }
    if (sectionId === 'community-events') loadBrowseUserEvents();
    if (sectionId === 'user-events-oversight') loadAllUserEventsForPastor();
    if (sectionId === 'spiritual-assistant' && chatMessages.length === 0) {
      setChatMessages([{ role: 'assistant', content: `Hello ${userData?.firstname || 'friend'}! 🙏 I'm your Spiritual AI Assistant. How can I help you today?\n\n⚠️ Disclaimer: While I can provide biblical guidance and encouragement, it is important that you also maintain your personal communication with God through prayer and His Word to receive true wisdom. I am just your AI Assistant — the Holy Spirit is your ultimate Counselor and Guide.` }]);
    }
  };

  // ============================================
  // DATA FETCHERS
  // ============================================
  const fetchDailyVerse = async (ministry) => {
    try {
      const cacheKey = 'dailyVerseCache';
      const cached = localStorage.getItem(cacheKey);
      const today = new Date().toDateString();
      if (cached) { const c = JSON.parse(cached); if (c.date === today && c.verse?.verse) { setDailyVerse(c.verse); return; } }

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: `You provide daily Bible verses for church ministry members (${ministry || 'general'} ministry). Return ONLY a JSON object: {"verse":"...", "reference":"Book Chapter:Verse", "explanation":"brief 1-2 sentence explanation"}` },
            { role: 'user', content: `Provide an encouraging Bible verse for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` },
          ],
          temperature: 0.8, max_tokens: 300,
        }),
      });
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('No response');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const verse = JSON.parse(jsonMatch[0]);
        setDailyVerse(verse);
        localStorage.setItem(cacheKey, JSON.stringify({ date: today, verse }));
      }
    } catch { setDailyVerse({ verse: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you.', reference: 'Jeremiah 29:11', explanation: '' }); }
  };

  // ============================================
  // PENDING PAGE FUNCTIONS
  // ============================================
  const cyclePendingVerse = () => {
    const current = PENDING_ENCOURAGEMENT_VERSES.indexOf(pendingAiVerse);
    const next = (current + 1) % PENDING_ENCOURAGEMENT_VERSES.length;
    setPendingAiVerse(PENDING_ENCOURAGEMENT_VERSES[next]);
  };

  const cyclePendingFact = () => {
    const nextIdx = (pendingFactIndex + 1) % PENDING_BIBLE_FACTS.length;
    setPendingFactIndex(nextIdx);
    setPendingFunFact(PENDING_BIBLE_FACTS[nextIdx]);
  };

  const nextPendingTrivia = () => {
    setPendingGameResult(null);
    setPendingGameAnswer('');
    // Pick a random question not recently used
    let available = PENDING_TRIVIA_QUESTIONS.filter((_, i) => !pendingTriviaUsed.includes(i));
    if (available.length === 0) {
      // Reset if all used
      setPendingTriviaUsed([]);
      available = PENDING_TRIVIA_QUESTIONS;
    }
    const randomIdx = Math.floor(Math.random() * available.length);
    const picked = available[randomIdx];
    const globalIdx = PENDING_TRIVIA_QUESTIONS.indexOf(picked);
    setPendingTriviaUsed(prev => [...prev, globalIdx]);
    setPendingGameQuestion(picked);
    setPendingGameActive(true);
  };

  const submitPendingGameAnswer = (selectedIndex) => {
    if (pendingGameResult !== null) return;
    const isCorrect = selectedIndex === pendingGameQuestion.correct;
    setPendingGameResult({ selected: selectedIndex, isCorrect });
    setPendingGameScore(prev => ({ correct: prev.correct + (isCorrect ? 1 : 0), total: prev.total + 1 }));
  };

  const savePendingSetup = async () => {
    if (!userData?.email) return;
    setPendingSetupSaving(true);
    try {
      const res = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userData.email, firstname: userData.firstname, lastname: userData.lastname, birthdate: pendingBirthdate, life_verse: pendingLifeVerse }),
      });
      const data = await res.json();
      if (data.success) {
        const updated = { ...userData, birthdate: pendingBirthdate, life_verse: pendingLifeVerse };
        setUserData(updated);
        setProfileForm(prev => ({ ...prev, birthdate: pendingBirthdate, life_verse: pendingLifeVerse }));
        sessionStorage.setItem('userData', JSON.stringify(updated));
        localStorage.setItem('userData', JSON.stringify(updated));
        showToast('✨ Profile setup saved!', 'success');
        setPendingSetupDone(true);
        // Fetch AI feedback for life verse
        if (pendingLifeVerse && pendingLifeVerse.trim()) {
          fetchLifeVerseFeedback(pendingLifeVerse);
        }
      } else { showToast(data.message || 'Failed to save', 'danger'); }
    } catch { showToast('Failed to save profile setup', 'danger'); }
    finally { setPendingSetupSaving(false); }
  };

  const fetchLifeVerseFeedback = async (verse) => {
    setPendingLifeVerseFeedbackLoading(true);
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: 'You are a warm, loving church elder who gives heartfelt, encouraging feedback when someone shares their life verse. Be personal, warm, and uplifting. Keep it to 3-4 sentences. Use emojis sparingly but meaningfully.' },
            { role: 'user', content: `Someone just chose "${verse}" as their life verse. Give them a heartwarming, encouraging response about what a beautiful choice that is and what it means for their spiritual journey.` },
          ],
          temperature: 0.85, max_tokens: 300,
        }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) setPendingLifeVerseFeedback(text.trim());
    } catch { setPendingLifeVerseFeedback('What a beautiful verse to live by! 🙏 God\'s Word is a lamp unto our feet, and the verse you chose will be a constant source of strength and comfort in your journey. May it always remind you of His unfailing love!'); }
    finally { setPendingLifeVerseFeedbackLoading(false); }
  };

  const loadScheduleData = async () => {
    try {
      const res = await fetch('/api/schedules');
      const data = await res.json();
      if (data.success) setScheduleData(data.data || []);
    } catch { /* silent */ }
  };

  const loadBirthdays = async () => {
    try {
      const res = await fetch('/api/members/birthdates');
      const data = await res.json();
      if (data.success) setBirthdayData(data.data);
    } catch { /* silent */ }
  };

  const loadNotifications = async (userId) => {
    try {
      const res = await fetch(`/api/notifications?userId=${userId}`);
      const data = await res.json();
      if (data.success) {
        setNotifications(data.data);
        setUnreadCount(data.data.filter((n) => !n.is_read).length);
      }
    } catch { /* silent */ }
  };

  const loadEvents = async () => {
    try {
      const res = await fetch('/api/events');
      const data = await res.json();
      if (data.success) setEvents(data.data);
    } catch { /* silent */ }
  };

  const loadAnnouncements = async () => {
    try {
      const res = await fetch('/api/announcements');
      const data = await res.json();
      if (data.success) setAnnouncements(data.data);
    } catch { /* silent */ }
  };

  const loadMeetings = async () => {
    try {
      const res = await fetch(`/api/meetings?upcoming=true`);
      const data = await res.json();
      if (data.success) setMeetings(data.data);
    } catch { /* silent */ }
  };

  const loadCommunityPosts = async () => {
    try {
      const res = await fetch(`/api/community${userData?.id ? `?userId=${userData.id}` : ''}`);
      const data = await res.json();
      if (data.success) setCommunityPosts(data.data);
    } catch { /* silent */ }
  };

  // ============================================
  // FACEBOOK LIVE STREAMS
  // ============================================
  const loadLiveStreams = async () => {
    try {
      const res = await fetch('/api/live-streams');
      const data = await res.json();
      if (Array.isArray(data)) {
        setLiveStreams(data);
        // Auto-select the first active live stream for community
        const activeLive = data.find(s => s.is_live && s.is_active);
        if (activeLive && !activeLiveStream) {
          setActiveLiveStream(activeLive);
          loadLiveStreamComments(activeLive.id);
          loadLiveStreamReactions(activeLive.id);
        }
      }
    } catch { /* silent */ }
  };

  const handleCreateLiveStream = async () => {
    if (!liveStreamForm.iframe_url.trim()) { showToast('Please enter the Facebook iframe embed code', 'warning'); return; }
    setLiveStreamLoading(true);
    try {
      const res = await fetch('/api/live-streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iframe_url: liveStreamForm.iframe_url,
          caption: liveStreamForm.caption || 'Sunday Service Live',
          title: liveStreamForm.title || 'Sunday Service Live',
          posted_by: userData?.id,
          posted_by_name: `${userData?.firstname} ${userData?.lastname}`,
        }),
      });
      const data = await res.json();
      if (data.id) {
        showToast('🎥 Live stream posted successfully!', 'success');
        setLiveStreamForm({ iframe_url: '', caption: 'Sunday Service Live', title: 'Sunday Service Live' });
        setShowLiveStreamForm(false);
        loadLiveStreams();
      } else { showToast(data.error || 'Failed to post live stream', 'danger'); }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
    setLiveStreamLoading(false);
  };

  const handleUpdateLiveStream = async (id, updates) => {
    try {
      const res = await fetch('/api/live-streams', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });
      const data = await res.json();
      if (data.id) {
        showToast('Live stream updated', 'success');
        loadLiveStreams();
      }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleDeleteLiveStream = async (id) => {
    if (!confirm('Are you sure you want to delete this live stream?')) return;
    try {
      await fetch(`/api/live-streams?id=${id}`, { method: 'DELETE' });
      showToast('Live stream removed', 'success');
      loadLiveStreams();
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const loadLiveStreamComments = async (streamId) => {
    try {
      const res = await fetch(`/api/live-streams/comments?stream_id=${streamId}&user_id=${userData?.id}`);
      const data = await res.json();
      if (Array.isArray(data)) setLiveStreamComments(data);
    } catch { /* silent */ }
  };

  const handleLiveStreamComment = async () => {
    if (!liveStreamCommentInput.trim() || !activeLiveStream) return;
    try {
      const res = await fetch('/api/live-streams/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_id: activeLiveStream.id,
          user_id: userData?.id,
          user_name: `${userData?.firstname} ${userData?.lastname}`,
          user_picture: userData?.profile_picture || '',
          content: liveStreamCommentInput,
          parent_id: liveStreamReplyTo?.id || null,
        }),
      });
      if (res.ok) {
        setLiveStreamCommentInput('');
        setLiveStreamReplyTo(null);
        loadLiveStreamComments(activeLiveStream.id);
      }
    } catch { /* silent */ }
  };

  const handleDeleteLiveComment = async (commentId) => {
    try {
      await fetch(`/api/live-streams/comments?id=${commentId}&user_id=${userData?.id}`, { method: 'DELETE' });
      loadLiveStreamComments(activeLiveStream.id);
    } catch { /* silent */ }
  };

  const loadLiveStreamReactions = async (streamId) => {
    try {
      const res = await fetch(`/api/live-streams/reactions?stream_id=${streamId}&user_id=${userData?.id}`);
      const data = await res.json();
      setLiveStreamReactionCount(data.count || 0);
      setLiveStreamUserReacted(data.userReacted || false);
    } catch { /* silent */ }
  };

  const handleLiveStreamReaction = async () => {
    if (!activeLiveStream) return;
    // Optimistic update
    setLiveStreamUserReacted(prev => !prev);
    setLiveStreamReactionCount(prev => liveStreamUserReacted ? prev - 1 : prev + 1);
    setLiveStreamReactAnimating(true);
    // Floating heart
    const heartId = Date.now();
    setLiveStreamFloatingHearts(prev => [...prev, heartId]);
    setTimeout(() => setLiveStreamFloatingHearts(prev => prev.filter(h => h !== heartId)), 1200);
    setTimeout(() => setLiveStreamReactAnimating(false), 600);
    try {
      await fetch('/api/live-streams/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream_id: activeLiveStream.id, user_id: userData?.id, user_name: `${userData?.firstname} ${userData?.lastname}` }),
      });
      loadLiveStreamReactions(activeLiveStream.id);
    } catch {
      // Rollback
      setLiveStreamUserReacted(prev => !prev);
      setLiveStreamReactionCount(prev => liveStreamUserReacted ? prev + 1 : prev - 1);
    }
  };

  const handleLiveCommentLike = async (commentId) => {
    setLiveStreamCommentLikeAnimating(prev => ({ ...prev, [commentId]: true }));
    setTimeout(() => setLiveStreamCommentLikeAnimating(prev => ({ ...prev, [commentId]: false })), 600);
    try {
      await fetch('/api/live-streams/comments/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_id: commentId, user_id: userData?.id, user_name: `${userData?.firstname} ${userData?.lastname}` }),
      });
      loadLiveStreamComments(activeLiveStream.id);
    } catch { /* silent */ }
  };

  const toggleLiveStreamFullscreen = () => {
    if (!liveStreamFullscreen) {
      const el = liveStreamFullscreenRef.current;
      if (el) {
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
      }
      setLiveStreamFullscreen(true);
      try { screen.orientation.lock('landscape').catch(() => {}); } catch {}
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      setLiveStreamFullscreen(false);
      try { screen.orientation.unlock(); } catch {}
    }
  };

  const extractIframeSrc = (iframeStr) => {
    const match = iframeStr.match(/src="([^"]+)"/);
    return match ? match[1] : iframeStr;
  };

  // Live Stream Share helpers
  const liveShareUrl = 'https://jsci.vercel.app/live';

  const handleLiveShareCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(liveShareUrl);
      setLiveShareCopied(true);
      setTimeout(() => setLiveShareCopied(false), 2500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = liveShareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setLiveShareCopied(true);
      setTimeout(() => setLiveShareCopied(false), 2500);
    }
  };

  const shareLiveToFacebook = () => {
    const text = activeLiveStream ? `🔴 Watch LIVE: ${activeLiveStream.caption || 'Sunday Service'} at Joyful Sound Church International! 🙏✨` : '🔴 Watch LIVE at Joyful Sound Church International! 🙏✨';
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(liveShareUrl)}&quote=${encodeURIComponent(text)}`, '_blank', 'width=600,height=400');
  };

  const shareLiveToMessenger = () => {
    window.open(`https://www.facebook.com/dialog/send?link=${encodeURIComponent(liveShareUrl)}&app_id=966242223397117&redirect_uri=${encodeURIComponent(liveShareUrl)}`, '_blank', 'width=600,height=400');
  };

  const shareLiveToWhatsApp = () => {
    const text = activeLiveStream ? `🔴 *LIVE NOW* - ${activeLiveStream.caption || 'Sunday Service'} at Joyful Sound Church International!\n🙏 Watch here: ${liveShareUrl}` : `🔴 Watch LIVE at Joyful Sound Church International!\n🙏 ${liveShareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareLiveToTelegram = () => {
    const text = activeLiveStream ? `🔴 LIVE NOW - ${activeLiveStream.caption || 'Sunday Service'} at Joyful Sound Church International!` : '🔴 Watch LIVE at Joyful Sound Church International!';
    window.open(`https://t.me/share/url?url=${encodeURIComponent(liveShareUrl)}&text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareLiveNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Joyful Sound Church International - Live',
          text: activeLiveStream ? `🔴 Watch LIVE: ${activeLiveStream.caption || 'Sunday Service'}` : '🔴 Watch LIVE at Joyful Sound Church International!',
          url: liveShareUrl,
        });
      } catch { /* user cancelled */ }
    }
  };

  // Real-time subscriptions for live streams
  useEffect(() => {
    if (!userData?.id) return;
    const streamSub = supabase.channel('live-streams-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_streams' }, () => { loadLiveStreams(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_stream_reactions' }, () => { if (activeLiveStream) loadLiveStreamReactions(activeLiveStream.id); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_stream_comments' }, () => { if (activeLiveStream) loadLiveStreamComments(activeLiveStream.id); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_stream_comment_likes' }, () => { if (activeLiveStream) loadLiveStreamComments(activeLiveStream.id); })
      .subscribe();
    return () => { supabase.removeChannel(streamSub); };
  }, [userData?.id, activeLiveStream?.id]);

  const loadMessages = async () => {
    try {
      if (!userData?.id) return;
      const res = await fetch(`/api/messages?userId=${userData.id}&type=${messageTab}`);
      const data = await res.json();
      if (data.success) setMessages(data.data);
    } catch { /* silent */ }
  };

  const loadAttendance = async () => {
    try {
      const res = await fetch(`/api/attendance?eventDate=${attendanceDate}`);
      const data = await res.json();
      if (data.success) setAttendanceRecords(data.data);
    } catch { /* silent */ }
  };

  const loadReports = async () => {
    try {
      const dashType = getDashboardType(userRole);
      const type = dashType === 'ministry' ? 'personal' : 'overview';
      const url = type === 'personal' ? `/api/reports?type=personal&userId=${userData?.id}` : '/api/reports?type=overview';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) setReportData(data.data);
    } catch { /* silent */ }
  };

  const loadAdminUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.success) { setAdminUsers(data.data); setAllUsers(data.data); }
    } catch { /* silent */ }
  };

  const loadMinistries = async () => {
    try {
      const res = await fetch('/api/admin/ministries');
      const data = await res.json();
      if (data.success) setMinistriesList(data.data);
    } catch { /* silent */ }
  };

  const loadRoles = async () => {
    try {
      const res = await fetch('/api/admin/roles');
      const data = await res.json();
      if (data.success) setRolesList(data.data);
    } catch { /* silent */ }
  };

  const loadAuditLogs = async () => {
    try {
      const res = await fetch('/api/admin/audit-logs');
      const data = await res.json();
      if (data.success) setAuditLogs(data.data);
    } catch { /* silent */ }
  };

  const loadSystemSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      if (data.success) setSystemSettings(data.data);
    } catch { /* silent */ }
  };

  const loadTermsConditions = async () => {
    setTermsLoading(true);
    try {
      const res = await fetch('/api/admin/terms');
      const data = await res.json();
      if (data.success) {
        setTermsContent(data.data.content || '');
        setTermsLastUpdated(data.data.updated_at || '');
      }
    } catch { /* silent */ }
    finally { setTermsLoading(false); }
  };

  const saveTermsConditions = async () => {
    setTermsSaving(true);
    try {
      const res = await fetch('/api/admin/terms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: termsContent,
          updatedBy: userData?.email || 'Admin',
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('✅ Terms & Conditions saved successfully!', 'success');
        setTermsLastUpdated(new Date().toISOString());
      } else {
        showToast('❌ Failed to save: ' + data.message, 'error');
      }
    } catch (err) {
      showToast('❌ Error saving Terms & Conditions', 'error');
    } finally { setTermsSaving(false); }
  };

  // Permission Controls
  const loadPermissionOverrides = async () => {
    try {
      const res = await fetch('/api/admin/permissions-control');
      const data = await res.json();
      if (data.success) {
        const map = {};
        (data.data || []).forEach((row) => {
          map[`${row.role}::${row.feature_key}`] = row.enabled;
        });
        setPermissionOverrides(map);
      }
    } catch { /* silent */ } finally {
      setPermissionsLoaded(true);
    }
  };

  const toggleFeaturePermission = async (role, featureKey, currentEnabled) => {
    const savingKey = `${role}::${featureKey}`;
    setPermCtrlSaving((prev) => ({ ...prev, [savingKey]: true }));
    try {
      const res = await fetch('/api/admin/permissions-control', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, featureKey, enabled: !currentEnabled, updatedBy: userData?.id }),
      });
      const data = await res.json();
      if (data.success) {
        // Optimistic update (real-time will also fire)
        setPermissionOverrides((prev) => ({ ...prev, [savingKey]: !currentEnabled }));
        showToast(`${FEATURE_CONTROLS[featureKey]?.label || featureKey} ${!currentEnabled ? 'enabled' : 'disabled'} for ${role}`, 'success');
      } else {
        showToast(data.message || 'Failed to update', 'danger');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'danger');
    } finally {
      setPermCtrlSaving((prev) => ({ ...prev, [savingKey]: false }));
    }
  };

  const resetRolePermissions = async (role) => {
    try {
      const res = await fetch(`/api/admin/permissions-control?role=${encodeURIComponent(role)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast(`All overrides reset for ${role}`, 'success');
        loadPermissionOverrides();
      } else {
        showToast(data.message || 'Failed to reset', 'danger');
      }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const bulkToggleRole = async (role, enabled) => {
    setPermCtrlLoading(true);
    try {
      const controls = Object.keys(FEATURE_CONTROLS).map((key) => ({ role, feature_key: key, enabled }));
      const res = await fetch('/api/admin/permissions-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ controls, updatedBy: userData?.id }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`All features ${enabled ? 'enabled' : 'disabled'} for ${role}`, 'success');
        loadPermissionOverrides();
      } else {
        showToast(data.message || 'Failed', 'danger');
      }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
    finally { setPermCtrlLoading(false); }
  };

  // Permission Control: Verify admin access password to unlock
  const verifyPermCtrlPassword = async () => {
    if (!permCtrlPasswordInput.trim()) {
      setPermCtrlPasswordError('Please enter your access password');
      return;
    }
    setPermCtrlVerifying(true);
    setPermCtrlPasswordError('');
    try {
      const res = await fetch('/api/profile/admin-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData?.id, password: permCtrlPasswordInput }),
      });
      const data = await res.json();
      if (data.success) {
        setPermCtrlUnlocked(true);
        setPermCtrlPasswordInput('');
        setPermCtrlPasswordError('');
        showToast('Access granted', 'success');
      } else {
        setPermCtrlPasswordError(data.noPassword ? 'No access password set. Please set one in My Profile → Security tab first.' : data.message || 'Incorrect password');
      }
    } catch (e) {
      setPermCtrlPasswordError('Error verifying password');
    } finally {
      setPermCtrlVerifying(false);
    }
  };

  // Admin Access Password: Check if set
  const checkAdminAccessPassword = async () => {
    if (!userData?.id) return;
    try {
      const res = await fetch(`/api/profile/admin-password?userId=${userData.id}`);
      const data = await res.json();
      if (data.success) setHasAdminAccessPassword(data.hasPassword);
    } catch { /* silent */ }
  };

  // Admin Access Password: Set/Update
  const saveAdminAccessPassword = async () => {
    if (!adminAccessPassword.trim()) {
      showToast('Please enter a password', 'warning');
      return;
    }
    if (adminAccessPassword.length < 4) {
      showToast('Password must be at least 4 characters', 'warning');
      return;
    }
    if (adminAccessPassword !== adminAccessPasswordConfirm) {
      showToast('Passwords do not match', 'warning');
      return;
    }
    setAdminPasswordSaving(true);
    try {
      const res = await fetch('/api/profile/admin-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData?.id, password: adminAccessPassword }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Admin access password saved!', 'success');
        setAdminAccessPassword('');
        setAdminAccessPasswordConfirm('');
        setHasAdminAccessPassword(true);
      } else {
        showToast(data.message || 'Failed to save', 'danger');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'danger');
    } finally {
      setAdminPasswordSaving(false);
    }
  };

  // Toggle category expand/collapse in Permission Control
  const togglePermCtrlCategory = (cat) => {
    setPermCtrlExpandedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  // Helper: check if a feature is enabled for the current user's role
  const featureOn = (featureKey) => isFeatureEnabled(userRole, featureKey, permissionOverrides);

  // User-Created Events
  const loadUserEvents = async () => {
    try {
      if (!userData?.id) return;
      const res = await fetch(`/api/user-events?createdBy=${userData.id}&userId=${userData.id}`);
      const data = await res.json();
      if (data.success) setUserEvents(data.data);
    } catch { /* silent */ }
  };

  const loadAllUserEventsForPastor = async () => {
    try {
      const res = await fetch(`/api/user-events?all=true&userId=${userData?.id}`);
      const data = await res.json();
      if (data.success) setAllUserEventsForPastor(data.data);
    } catch { /* silent */ }
  };

  const loadBrowseUserEvents = async () => {
    try {
      const res = await fetch(`/api/user-events?upcoming=true&userId=${userData?.id}`);
      const data = await res.json();
      if (data.success) setBrowseUserEvents(data.data);
    } catch { /* silent */ }
  };

  const loadUserEventRsvps = async (eventId) => {
    try {
      const res = await fetch(`/api/user-events/rsvp?eventId=${eventId}`);
      const data = await res.json();
      if (data.success) setUserEventRsvps(data);
    } catch { /* silent */ }
  };

  const loadPastorEventRsvps = async (eventId) => {
    try {
      const res = await fetch(`/api/user-events/rsvp?eventId=${eventId}`);
      const data = await res.json();
      if (data.success) setPastorEventRsvps(data);
    } catch { /* silent */ }
  };

  // Praise & Worship data loaders
  const loadPawSchedules = async () => {
    try {
      const res = await fetch('/api/praise-worship?type=schedules');
      const data = await res.json();
      if (data.success) setPawSchedules(data.data || []);
    } catch { /* silent */ }
  };

  const loadPawMySchedules = async () => {
    try {
      if (!userData?.id) return;
      const res = await fetch(`/api/praise-worship?type=my-schedule&userId=${userData.id}`);
      const data = await res.json();
      if (data.success) setPawMySchedules(data.data || []);
    } catch { /* silent */ }
  };

  const loadPawNotifications = async () => {
    try {
      if (!userData?.id) return;
      const res = await fetch(`/api/praise-worship?type=notifications&userId=${userData.id}`);
      const data = await res.json();
      if (data.success) setPawNotifications(data.data || []);
    } catch { /* silent */ }
  };

  // Fetch lyrics using Groq AI (passes YouTube link for accurate song identification)
  const fetchSongLyrics = async (songTitle, songLink, scheduleDate) => {
    // Split combined "TITLE - ARTIST" format into clean parts for searching
    let cleanTitle = songTitle || '';
    let cleanArtist = '';
    if (cleanTitle.includes(' - ')) {
      const parts = cleanTitle.split(' - ');
      cleanTitle = parts[0].trim();
      cleanArtist = parts.slice(1).join(' - ').trim();
    }
    setPawLyricsModal({ title: cleanTitle, lyrics: null, artist: cleanArtist, loading: true, source: null });
    try {
      let libraryMatch = null;

      // Strategy 1: Check by linked schedule date first (most reliable)
      if (scheduleDate) {
        const linkedRes = await fetch(`/api/lyrics/library?scheduleDate=${encodeURIComponent(scheduleDate)}`);
        const linkedData = await linkedRes.json();
        if (linkedData.success && linkedData.data?.length > 0) {
          libraryMatch = linkedData.data.find(l => {
            const lt = (l.title || '').toLowerCase();
            const ct = cleanTitle.toLowerCase();
            return lt.includes(ct) || ct.includes(lt);
          });
        }
      }

      // Strategy 2: Search by clean title
      if (!libraryMatch) {
        const libRes = await fetch(`/api/lyrics/library?search=${encodeURIComponent(cleanTitle)}`);
        const libData = await libRes.json();
        if (libData.success && libData.data?.length > 0) {
          libraryMatch = libData.data.find(l => {
            const lt = (l.title || '').toLowerCase();
            const ct = cleanTitle.toLowerCase();
            return lt.includes(ct) || ct.includes(lt);
          });
        }
      }

      // If multimedia has prepared this → show their version
      if (libraryMatch && libraryMatch.lyrics_plain) {
        setPawLyricsModal({
          title: libraryMatch.title,
          lyrics: libraryMatch.lyrics_plain,
          artist: libraryMatch.artist || cleanArtist,
          loading: false,
          source: 'multimedia',
          preparedBy: libraryMatch.prepared_by_name,
        });
        return;
      }

      // Fallback to AI lyrics
      let url = `/api/lyrics?title=${encodeURIComponent(songTitle)}`;
      if (songLink) url += `&link=${encodeURIComponent(songLink)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && data.data && data.data.lyrics) {
        setPawLyricsModal({ title: data.data.title || cleanTitle, lyrics: data.data.lyrics, artist: data.data.artist || cleanArtist, loading: false, source: 'ai' });
      } else {
        setPawLyricsModal({ title: cleanTitle, lyrics: null, artist: cleanArtist, loading: false, source: null });
      }
    } catch {
      setPawLyricsModal({ title: cleanTitle, lyrics: null, artist: cleanArtist, loading: false, source: null });
    }
  };

  // ============================================
  // MULTIMEDIA LYRICS LIBRARY
  // ============================================
  const isMultimediaUser = (userData?.ministry === 'Media') || (userData?.sub_role || '').includes('Multimedia') || (userData?.sub_role || '').includes('Lyrics');

  const loadLyricsLibrary = async () => {
    try {
      const params = new URLSearchParams();
      if (lyricsSearch) params.set('search', lyricsSearch);
      if (lyricsLangFilter && lyricsLangFilter !== 'All') params.set('language', lyricsLangFilter);
      const res = await fetch(`/api/lyrics/library?${params.toString()}`);
      const data = await res.json();
      if (data.success) setLyricsLibrary(data.data || []);
    } catch { /* silent */ }
  };

  const loadMultimediaLineupNotifs = async () => {
    try {
      // Fetch upcoming schedules that have songs (for Multimedia to prepare lyrics)
      const res = await fetch('/api/praise-worship?type=schedules');
      const data = await res.json();
      if (data.success) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const upcoming = (data.data || []).filter(s => {
          if (new Date(s.scheduleDate) < today) return false;
          const allSongs = [...(s.slowSongs || []), ...(s.fastSongs || [])];
          return allSongs.some(song => song.title);
        });
        setMultimediaLineupNotifs(upcoming);
      }
    } catch { /* silent */ }
  };

  const handleLyricsAiAutofill = async () => {
    const link = lyricsEditorForm.youtube_link;
    if (!link) { showToast('Please enter a YouTube link first', 'warning'); return; }
    setLyricsAiLoading(true);
    try {
      const res = await fetch('/api/lyrics/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai-autofill', youtubeLink: link }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setLyricsEditorForm(prev => ({
          ...prev,
          title: data.data.title || prev.title,
          artist: data.data.artist || prev.artist,
          language: data.data.language || prev.language,
          sections: data.data.sections || prev.sections,
          lyrics_html: data.data.lyrics_html || prev.lyrics_html,
          lyrics_plain: data.data.lyrics_plain || prev.lyrics_plain,
        }));
        showToast('AI auto-filled song details!', 'success');
      } else {
        showToast(data.message || 'AI could not identify this song', 'warning');
      }
    } catch (e) { showToast('AI autofill failed: ' + e.message, 'danger'); }
    setLyricsAiLoading(false);
  };

  const handleLyricsAiFormat = async () => {
    if (!lyricsPasteText.trim()) { showToast('Please paste lyrics text first', 'warning'); return; }
    setLyricsFormatLoading(true);
    try {
      const res = await fetch('/api/lyrics/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ai-format', rawLyrics: lyricsPasteText, title: lyricsEditorForm.title, artist: lyricsEditorForm.artist }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setLyricsEditorForm(prev => ({
          ...prev,
          sections: data.data.sections || prev.sections,
          lyrics_html: data.data.lyrics_html || prev.lyrics_html,
          lyrics_plain: data.data.lyrics_plain || prev.lyrics_plain,
          language: data.data.language || prev.language,
        }));
        setLyricsPasteText('');
        showToast('Lyrics formatted into sections!', 'success');
      } else {
        showToast(data.message || 'Could not format lyrics', 'warning');
      }
    } catch (e) { showToast('Format failed: ' + e.message, 'danger'); }
    setLyricsFormatLoading(false);
  };

  const handleLyricsSave = async () => {
    if (!lyricsEditorForm.title.trim()) { showToast('Song title is required', 'warning'); return; }
    setLyricsEditorLoading(true);
    try {
      const isEditing = !!lyricsEditorData;
      const body = {
        title: lyricsEditorForm.title,
        artist: lyricsEditorForm.artist,
        language: lyricsEditorForm.language,
        youtube_link: lyricsEditorForm.youtube_link,
        sections: lyricsEditorForm.sections,
        lyrics_html: lyricsEditorForm.lyrics_html,
        lyrics_plain: lyricsEditorForm.lyrics_plain,
        prepared_by: userData?.id,
        prepared_by_name: `${userData?.firstname} ${userData?.lastname}`,
        status: 'Published',
      };
      const res = await fetch('/api/lyrics/library', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEditing ? { ...body, id: lyricsEditorData.id } : body),
      });
      const data = await res.json();
      if (data.success) {
        showToast(isEditing ? 'Lyrics updated!' : 'Lyrics saved to library!', 'success');
        setLyricsEditorOpen(false);
        setLyricsEditorData(null);
        setLyricsEditorForm({ title: '', artist: '', language: 'English', youtube_link: '', sections: [], lyrics_plain: '', lyrics_html: '' });
        setLyricsPasteText('');
        loadLyricsLibrary();
      } else showToast(data.message || 'Failed to save', 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
    setLyricsEditorLoading(false);
  };

  const handleLyricsDelete = async (id) => {
    if (!confirm('Delete this lyrics entry?')) return;
    try {
      const res = await fetch(`/api/lyrics/library?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showToast('Lyrics deleted!', 'success'); loadLyricsLibrary(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleLyricsLinkToSchedule = async (lyricsId, scheduleDate) => {
    try {
      const res = await fetch('/api/lyrics/library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lyricsId, action: 'link-schedule', scheduleDate: scheduleDate }),
      });
      const data = await res.json();
      if (data.success) { showToast('Lyrics linked to schedule!', 'success'); setLyricsLinkModal(null); loadLyricsLibrary(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const openLyricsEditor = (existing = null) => {
    if (existing) {
      setLyricsEditorData(existing);
      setLyricsEditorForm({
        title: existing.title || '',
        artist: existing.artist || '',
        language: existing.language || 'English',
        youtube_link: existing.youtube_link || '',
        sections: existing.sections || [],
        lyrics_plain: existing.lyrics_plain || '',
        lyrics_html: existing.lyrics_html || '',
      });
    } else {
      setLyricsEditorData(null);
      setLyricsEditorForm({ title: '', artist: '', language: 'English', youtube_link: '', sections: [], lyrics_plain: '', lyrics_html: '' });
    }
    setLyricsPasteText('');
    setLyricsEditorOpen(true);
  };

  const updateLyricsSection = (index, field, value) => {
    setLyricsEditorForm(prev => {
      const sections = [...prev.sections];
      sections[index] = { ...sections[index], [field]: value };
      // Rebuild plain/html from sections
      const plain = sections.map(s => `[${s.label}]\n${s.content}`).join('\n\n');
      const html = sections.map(s => `<div class="lyrics-section"><h4>${s.label}</h4><p>${s.content.replace(/\n/g, '<br/>')}</p></div>`).join('');
      return { ...prev, sections, lyrics_plain: plain, lyrics_html: html };
    });
  };

  const addLyricsSection = () => {
    setLyricsEditorForm(prev => ({
      ...prev,
      sections: [...prev.sections, { label: 'Verse ' + (prev.sections.filter(s => s.label.startsWith('Verse')).length + 1), content: '' }],
    }));
  };

  const removeLyricsSection = (index) => {
    setLyricsEditorForm(prev => {
      const sections = prev.sections.filter((_, i) => i !== index);
      const plain = sections.map(s => `[${s.label}]\n${s.content}`).join('\n\n');
      const html = sections.map(s => `<div class="lyrics-section"><h4>${s.label}</h4><p>${s.content.replace(/\n/g, '<br/>')}</p></div>`).join('');
      return { ...prev, sections, lyrics_plain: plain, lyrics_html: html };
    });
  };

  const moveLyricsSection = (index, direction) => {
    setLyricsEditorForm(prev => {
      const sections = [...prev.sections];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= sections.length) return prev;
      [sections[index], sections[newIndex]] = [sections[newIndex], sections[index]];
      const plain = sections.map(s => `[${s.label}]\n${s.content}`).join('\n\n');
      const html = sections.map(s => `<div class="lyrics-section"><h4>${s.label}</h4><p>${s.content.replace(/\n/g, '<br/>')}</p></div>`).join('');
      return { ...prev, sections, lyrics_plain: plain, lyrics_html: html };
    });
  };

  // YouTube IFrame API: load script once
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  }, []);

  // YouTube IFrame API: create/destroy player when song changes
  useEffect(() => {
    if (pawPlayerRef.current) {
      try { pawPlayerRef.current.destroy(); } catch (e) { /* ignore */ }
      pawPlayerRef.current = null;
    }
    if (pawProgressRef.current) {
      clearInterval(pawProgressRef.current);
      pawProgressRef.current = null;
    }
    if (!pawPlayingSong) {
      setPawAudioTime({ current: 0, duration: 0 });
      return;
    }
    const createPlayer = () => {
      const wrapper = document.getElementById('paw-yt-player-wrapper');
      if (wrapper) wrapper.innerHTML = '<div id="paw-yt-player-el"></div>';
      pawPlayerRef.current = new window.YT.Player('paw-yt-player-el', {
        height: '0', width: '0',
        videoId: pawPlayingSong.videoId,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1 },
        events: {
          onReady: (ev) => {
            ev.target.playVideo();
            setTimeout(() => {
              const dur = ev.target.getDuration ? ev.target.getDuration() : 0;
              setPawAudioTime({ current: 0, duration: dur });
            }, 500);
            pawProgressRef.current = setInterval(() => {
              if (pawPlayerRef.current && pawPlayerRef.current.getCurrentTime) {
                const ct = pawPlayerRef.current.getCurrentTime();
                const d = pawPlayerRef.current.getDuration();
                setPawAudioTime({ current: ct, duration: d });
              }
            }, 500);
          },
          onStateChange: (ev) => {
            if (ev.data === window.YT.PlayerState.ENDED) {
              setPawPlayingSong(null);
            }
          }
        }
      });
    };
    const waitForYT = () => {
      if (window.YT && window.YT.Player) { createPlayer(); }
      else { setTimeout(waitForYT, 300); }
    };
    waitForYT();
    return () => {
      if (pawPlayerRef.current) { try { pawPlayerRef.current.destroy(); } catch (e) { /* ignore */ } pawPlayerRef.current = null; }
      if (pawProgressRef.current) { clearInterval(pawProgressRef.current); pawProgressRef.current = null; }
    };
  }, [pawPlayingSong?.key]);

  const formatPawTime = (sec) => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handlePawSeek = (e) => {
    if (!pawPlayerRef.current || !pawAudioTime.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const seekTime = pct * pawAudioTime.duration;
    pawPlayerRef.current.seekTo(seekTime, true);
    setPawAudioTime(prev => ({ ...prev, current: seekTime }));
  };

  const fetchPawBibleVerse = async (roleLabel) => {
    if (pawBibleVerse && pawBibleVerse.role === roleLabel) return; // Already fetched for this role
    setPawBibleVerseLoading(true);
    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: `You provide encouraging Bible verses specifically for church ministry members serving as "${roleLabel}" in Praise and Worship ministry. The verse should relate to their role and encourage them in their service. Return ONLY a JSON object: {"verse":"the actual verse text", "reference":"Book Chapter:Verse", "encouragement":"a brief 1-2 sentence encouragement specifically for this role"}` },
            { role: 'user', content: `Provide an encouraging Bible verse for a ${roleLabel} in the Praise and Worship ministry for today, ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.` },
          ],
          temperature: 0.8, max_tokens: 300,
        }),
      });
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const verse = JSON.parse(jsonMatch[0]);
          setPawBibleVerse({ ...verse, role: roleLabel });
        }
      }
    } catch { setPawBibleVerse({ verse: 'Sing to the Lord a new song; sing to the Lord, all the earth.', reference: 'Psalm 96:1', encouragement: 'Your worship is a beautiful offering to God. Keep singing His praises!', role: roleLabel }); }
    setPawBibleVerseLoading(false);
  };

  // ============================================
  // ACTION HANDLERS
  // ============================================

  // -- Events --
  const handleEventSubmit = async () => {
    try {
      const method = editingEvent ? 'PUT' : 'POST';
      const body = editingEvent
        ? { id: editingEvent.id, title: eventForm.title, description: eventForm.description, eventDate: eventForm.eventDate, endDate: eventForm.endDate, location: eventForm.location }
        : { ...eventForm, createdBy: userData?.id };
      const res = await fetch('/api/events', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowEventForm(false); setEditingEvent(null); setEventForm({ title: '', description: '', eventDate: '', endDate: '', location: '' }); loadEvents(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleDeleteEvent = async (id) => {
    if (!confirm('Delete this event?')) return;
    const res = await fetch(`/api/events?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) loadEvents();
  };

  const handleEventRSVP = async (eventId, status) => {
    const res = await fetch('/api/events/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId, userId: userData?.id, status }) });
    const data = await res.json();
    if (data.success) showToast(`RSVP: ${status}`, 'success');
  };

  // -- Announcements --
  const handleAnnouncementSubmit = async () => {
    try {
      const method = editingAnnouncement ? 'PUT' : 'POST';
      const body = editingAnnouncement
        ? { id: editingAnnouncement.id, ...announcementForm }
        : { ...announcementForm, author: userData?.id, authorName: `${userData?.firstname} ${userData?.lastname}` };
      const res = await fetch('/api/announcements', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowAnnouncementForm(false); setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', isPinned: false }); loadAnnouncements(); }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleDeleteAnnouncement = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    const res = await fetch(`/api/announcements?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) loadAnnouncements();
  };

  // -- Meetings --
  const handleMeetingSubmit = async () => {
    try {
      const body = { ...meetingForm, ministry: userData?.ministry, createdBy: userData?.id, createdByName: `${userData?.firstname} ${userData?.lastname}` };
      const res = await fetch('/api/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowMeetingForm(false); setMeetingForm({ title: '', description: '', meetingDate: '', location: '' }); loadMeetings(); }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleMeetingRSVP = async (meetingId, status) => {
    const res = await fetch('/api/meetings/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingId, userId: userData?.id, status }) });
    const data = await res.json();
    if (data.success) showToast(`RSVP: ${status}`, 'success');
  };

  // -- User-Created Events --
  const handleUserEventSubmit = async () => {
    try {
      if (editingUserEvent) {
        const res = await fetch('/api/user-events', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingUserEvent.id,
            userId: userData?.id,
            userRole,
            title: userEventForm.title,
            description: userEventForm.description,
            eventType: userEventForm.eventType,
            eventDate: userEventForm.eventDate,
            endDate: userEventForm.endDate,
            location: userEventForm.location,
          }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Event updated successfully!', 'success');
          setShowUserEventForm(false);
          setEditingUserEvent(null);
          setUserEventForm({ title: '', description: '', eventType: 'Event', eventDate: '', endDate: '', location: '' });
          loadUserEvents();
          if (activeSection === 'user-events-oversight') loadAllUserEventsForPastor();
        } else showToast(data.message, 'danger');
      } else {
        const res = await fetch('/api/user-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...userEventForm,
            createdBy: userData?.id,
            createdByName: `${userData?.firstname} ${userData?.lastname}`,
            ministry: userData?.ministry || null,
          }),
        });
        const data = await res.json();
        if (data.success) {
          showToast('Event created successfully!', 'success');
          setShowUserEventForm(false);
          setUserEventForm({ title: '', description: '', eventType: 'Event', eventDate: '', endDate: '', location: '' });
          loadUserEvents();
        } else showToast(data.message, 'danger');
      }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleDeleteUserEvent = async (id) => {
    if (!confirm('Delete this event?')) return;
    const res = await fetch(`/api/user-events?id=${id}&userId=${userData?.id}&userRole=${userRole}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) {
      loadUserEvents();
      if (activeSection === 'user-events-oversight') loadAllUserEventsForPastor();
    }
  };

  const handleUserEventRSVP = async (eventId, status) => {
    try {
      const res = await fetch('/api/user-events/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, userId: userData?.id, status }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`RSVP: ${status}`, 'success');
        loadUserEvents();
        loadBrowseUserEvents();
        if (activeSection === 'user-events-oversight') loadAllUserEventsForPastor();
      }
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleUpdateEventPermissions = async (userId, allowedTypes) => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, action: 'update-event-permissions', allowed_event_types: allowedTypes }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Event permissions updated!', 'success');
        setEventPermissionsUser(null);
        loadAdminUsers();
        // If admin updated their own permissions, refresh local session
        if (userId === userData?.id) {
          const updated = { ...userData, allowed_event_types: allowedTypes };
          setUserData(updated);
          sessionStorage.setItem('userData', JSON.stringify(updated));
          localStorage.setItem('userData', JSON.stringify(updated));
        }
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  // -- Community Hub --
  const [likeAnimating, setLikeAnimating] = useState({});
  const [deletingPost, setDeletingPost] = useState(null);

  // ============================================
  // BIBLE VERSE SHARE FOR COMMUNITY
  // ============================================
  const loadVerseForShare = async () => {
    if (!verseShareRef.trim()) return;
    setVerseShareLoading(true);
    setVerseShareText('');
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'system', content: 'You are a Bible verse provider. Given a Bible reference, return ONLY the verse text in NIV translation. No commentary, no headings — just the verse text. If the reference is invalid, say "Verse not found. Please check the reference."' },
            { role: 'user', content: `Provide the full text of ${verseShareRef.trim()} in NIV.` }
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setVerseShareText(content || 'Could not load verse. Please try again.');
    } catch {
      setVerseShareText('Could not load verse. Please check your connection.');
    } finally {
      setVerseShareLoading(false);
    }
  };

  const handleShareVersePost = async () => {
    if (!verseShareText || verseShareText.includes('not found')) return;
    const content = `📖 ${verseShareRef.trim()}\n\n"${verseShareText.trim()}"\n${verseShareReflection.trim() ? `\n💭 My Reflection:\n${verseShareReflection.trim()}` : ''}`;
    const res = await fetch('/api/community', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorId: userData?.id, authorName: `${userData?.firstname} ${userData?.lastname}`, content }),
    });
    const data = await res.json();
    if (data.success) {
      setShowVerseShareModal(false);
      setVerseShareRef('');
      setVerseShareText('');
      setVerseShareReflection('');
      loadCommunityPosts();
      showToast('📖 Bible verse shared!', 'success');
    }
  };

  // ============================================
  // COMMUNITY POST ALGORITHM
  // ============================================
  const getAlgorithmSortedPosts = (posts) => {
    if (!posts || posts.length === 0) return [];
    const userId = userData?.id;
    // Separate pinned
    const pinned = posts.filter(p => p.is_pinned);
    const unpinned = posts.filter(p => !p.is_pinned);

    // Score each post (higher = shows first)
    const scored = unpinned.map(post => {
      let score = 0;
      const isOwn = post.author_id === userId;
      const hasLiked = post.liked;
      const hasViewed = viewedPosts.includes(post.id);
      const hoursSincePost = (Date.now() - new Date(post.created_at).getTime()) / (1000 * 60 * 60);

      // Unseen posts get highest boost
      if (!hasViewed) score += 100;
      // Posts user hasn't reacted to get a boost
      if (!hasLiked && !isOwn) score += 50;
      // Posts with engagement get moderate boost
      score += Math.min((post.likeCount || 0) * 2, 20);
      score += Math.min((post.commentCount || 0) * 3, 30);
      // Recency bonus (newer = higher)
      if (hoursSincePost < 1) score += 40;
      else if (hoursSincePost < 6) score += 25;
      else if (hoursSincePost < 24) score += 15;
      else if (hoursSincePost < 72) score += 5;
      // Own posts appear lower (user already saw them)
      if (isOwn) score -= 30;

      return { ...post, _score: score };
    });

    // Sort by score desc, then by date desc
    scored.sort((a, b) => b._score - a._score || new Date(b.created_at) - new Date(a.created_at));
    return [...pinned, ...scored];
  };

  // Mark posts as viewed when they render
  const markPostViewed = (postId) => {
    setViewedPosts(prev => {
      if (prev.includes(postId)) return prev;
      const updated = [...prev, postId].slice(-500); // keep last 500
      localStorage.setItem('viewedPosts', JSON.stringify(updated));
      return updated;
    });
  };

  const handleCreatePost = async () => {
    if (!newPostContent.trim()) return;
    const res = await fetch('/api/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorId: userData?.id, authorName: `${userData?.firstname} ${userData?.lastname}`, content: newPostContent }) });
    const data = await res.json();
    if (data.success) { setNewPostContent(''); loadCommunityPosts(); showToast('Post shared!', 'success'); }
  };

  const handleEditPost = async (postId) => {
    if (!editPostContent.trim()) return;
    const res = await fetch('/api/community', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: postId, content: editPostContent, userId: userData?.id }) });
    const data = await res.json();
    if (data.success) { setEditingPost(null); setEditPostContent(''); loadCommunityPosts(); showToast('Post updated!', 'success'); }
    else showToast(data.message || 'Failed to update', 'error');
  };

  const handleLikePost = async (postId) => {
    setCommunityPosts(prev => prev.map(p => p.id === postId ? { ...p, liked: !p.liked, likeCount: p.liked ? (p.likeCount - 1) : (p.likeCount + 1) } : p));
    setLikeAnimating(prev => ({ ...prev, [postId]: true }));
    setTimeout(() => setLikeAnimating(prev => ({ ...prev, [postId]: false })), 600);
    const res = await fetch('/api/community/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId, userId: userData?.id }) });
    if (!(await res.json()).success) loadCommunityPosts();
  };

  const handleDeletePost = async (postId) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    setDeletingPost(postId);
    setTimeout(async () => {
      const res = await fetch(`/api/community?id=${postId}&userId=${userData?.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { setCommunityPosts(prev => prev.filter(p => p.id !== postId)); showToast('Post deleted', 'success'); }
      else { showToast(data.message || 'Failed to delete', 'error'); }
      setDeletingPost(null);
    }, 300);
  };

  const loadPostComments = async (postId) => {
    const res = await fetch(`/api/community/comments?postId=${postId}&userId=${userData?.id}`);
    const data = await res.json();
    if (data.success) setPostComments((prev) => ({ ...prev, [postId]: data.data }));
  };

  const handleAddComment = async (postId) => {
    const content = commentInputs[postId];
    if (!content?.trim()) return;
    const res = await fetch('/api/community/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId, authorId: userData?.id, authorName: `${userData?.firstname} ${userData?.lastname}`, content }) });
    if ((await res.json()).success) { setCommentInputs((p) => ({ ...p, [postId]: '' })); loadPostComments(postId); loadCommunityPosts(); }
  };

  const handleEditComment = async (commentId, postId) => {
    if (!editCommentContent.trim()) return;
    const res = await fetch('/api/community/comments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: commentId, userId: userData?.id, content: editCommentContent }) });
    if ((await res.json()).success) { setEditingComment(null); setEditCommentContent(''); loadPostComments(postId); showToast('Comment updated', 'success'); }
    else showToast('Failed to update comment', 'error');
  };

  const handleDeleteComment = async (commentId, postId) => {
    if (!confirm('Delete this comment?')) return;
    const res = await fetch(`/api/community/comments?id=${commentId}&userId=${userData?.id}`, { method: 'DELETE' });
    if ((await res.json()).success) { loadPostComments(postId); loadCommunityPosts(); showToast('Comment deleted', 'success'); }
    else showToast('Failed to delete comment', 'error');
  };

  const handleLikeComment = async (commentId, postId) => {
    // Optimistic update
    setPostComments(prev => ({
      ...prev,
      [postId]: (prev[postId] || []).map(c => c.id === commentId ? { ...c, liked: !c.liked, likeCount: c.liked ? (c.likeCount - 1) : (c.likeCount + 1) } : c)
    }));
    setCommentLikeAnimating(prev => ({ ...prev, [commentId]: true }));
    setTimeout(() => setCommentLikeAnimating(prev => ({ ...prev, [commentId]: false })), 600);
    const res = await fetch('/api/community/comments/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commentId, userId: userData?.id }) });
    if (!(await res.json()).success) loadPostComments(postId);
  };

  const handleViewProfile = async (authorId, authorName, authorPicture) => {
    if (!authorId) return;
    try {
      const res = await fetch(`/api/profile/update?userId=${authorId}`);
      const data = await res.json();
      if (data.success) {
        setViewingProfile({ ...data.data, author_name: authorName, profile_picture: authorPicture || data.data?.profile_picture });
      } else {
        setViewingProfile({ author_name: authorName, profile_picture: authorPicture, role: 'Member' });
      }
    } catch {
      setViewingProfile({ author_name: authorName, profile_picture: authorPicture, role: 'Member' });
    }
  };

  const handlePinPost = async (postId, isPinned) => {
    await fetch('/api/community', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: postId, isPinned: !isPinned }) });
    loadCommunityPosts();
  };

  // Bible content for sidebar cards (rotates hourly)
  const bibleVerses = [
    { ref: 'Jeremiah 29:11', text: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.' },
    { ref: 'Philippians 4:13', text: 'I can do all things through Christ who strengthens me.' },
    { ref: 'Psalm 23:1', text: 'The Lord is my shepherd; I shall not want.' },
    { ref: 'Romans 8:28', text: 'And we know that in all things God works for the good of those who love him.' },
    { ref: 'Isaiah 41:10', text: 'So do not fear, for I am with you; do not be dismayed, for I am your God.' },
    { ref: 'Proverbs 3:5-6', text: 'Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.' },
    { ref: 'John 3:16', text: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.' },
    { ref: 'Psalm 46:1', text: 'God is our refuge and strength, an ever-present help in trouble.' },
    { ref: 'Matthew 11:28', text: 'Come to me, all you who are weary and burdened, and I will give you rest.' },
    { ref: 'Joshua 1:9', text: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.' },
    { ref: 'Psalm 119:105', text: 'Your word is a lamp for my feet, a light on my path.' },
    { ref: 'Romans 12:2', text: 'Do not conform to the pattern of this world, but be transformed by the renewing of your mind.' },
    { ref: '2 Corinthians 5:7', text: 'For we live by faith, not by sight.' },
    { ref: 'Galatians 5:22-23', text: 'But the fruit of the Spirit is love, joy, peace, forbearance, kindness, goodness, faithfulness, gentleness and self-control.' },
    { ref: 'Hebrews 11:1', text: 'Now faith is confidence in what we hope for and assurance about what we do not see.' },
    { ref: '1 John 4:19', text: 'We love because he first loved us.' },
    { ref: 'Ephesians 2:8-9', text: 'For it is by grace you have been saved, through faith—and this is not from yourselves, it is the gift of God.' },
    { ref: 'Psalm 37:4', text: 'Take delight in the Lord, and he will give you the desires of your heart.' },
    { ref: 'Colossians 3:23', text: 'Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.' },
    { ref: 'Lamentations 3:22-23', text: 'Because of the Lord\'s great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.' },
    { ref: 'Psalm 91:1-2', text: 'Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty.' },
    { ref: 'Isaiah 40:31', text: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles.' },
    { ref: 'Matthew 6:33', text: 'But seek first his kingdom and his righteousness, and all these things will be given to you as well.' },
    { ref: '2 Timothy 1:7', text: 'For the Spirit God gave us does not make us timid, but gives us power, love and self-discipline.' },
  ];

  const bibleFacts = [
    { emoji: '📖', fact: 'The Bible has 66 books — 39 in the Old Testament and 27 in the New Testament.' },
    { emoji: '✍️', fact: 'The Bible was written by about 40 different authors over approximately 1,500 years.' },
    { emoji: '📏', fact: 'The longest chapter in the Bible is Psalm 119, with 176 verses.' },
    { emoji: '📝', fact: 'The shortest verse in the Bible is John 11:35 — "Jesus wept."' },
    { emoji: '🌍', fact: 'The Bible has been translated into over 3,500 languages worldwide.' },
    { emoji: '📚', fact: 'There are 31,102 verses in the Bible.' },
    { emoji: '🕊️', fact: 'The word "love" appears 310 times in the King James Version.' },
    { emoji: '⏳', fact: 'Methuselah is the oldest person in the Bible — he lived 969 years.' },
    { emoji: '🦁', fact: 'The book of Esther never mentions the word "God" directly.' },
    { emoji: '🎵', fact: 'The Psalms is the longest book in the Bible with 150 chapters.' },
    { emoji: '🐋', fact: 'Jonah survived three days and three nights inside a great fish.' },
    { emoji: '👶', fact: 'Samuel was the youngest person in the Bible to hear God\'s voice.' },
    { emoji: '🗡️', fact: 'David defeated Goliath with just a sling and a single stone.' },
    { emoji: '🌊', fact: 'Moses parted the Red Sea so the Israelites could escape Egypt.' },
    { emoji: '🔥', fact: 'The burning bush that Moses saw was not consumed by the fire.' },
    { emoji: '🌈', fact: 'The rainbow is God\'s promise to Noah to never flood the entire earth again.' },
    { emoji: '🍞', fact: 'Jesus fed 5,000 people with just five loaves and two fish.' },
    { emoji: '💪', fact: 'Samson\'s strength came from his uncut hair as a Nazirite vow to God.' },
    { emoji: '🏛️', fact: 'Solomon\'s Temple took seven years to build.' },
    { emoji: '📜', fact: 'The Dead Sea Scrolls, discovered in 1947, contain the oldest known biblical manuscripts.' },
    { emoji: '🌟', fact: 'The Star of Bethlehem guided the wise men to baby Jesus.' },
    { emoji: '🐑', fact: 'Jesus is called the Lamb of God, symbolizing His sacrifice for humanity.' },
    { emoji: '🗝️', fact: 'Jesus gave Peter the "keys to the kingdom of heaven" in Matthew 16:19.' },
    { emoji: '🌿', fact: 'The Garden of Eden had the Tree of Life and the Tree of Knowledge of Good and Evil.' },
  ];

  const bibleTrivia = [
    { q: 'Who built the ark?', a: 'Noah — he was commanded by God to build it before the great flood.' },
    { q: 'What are the first words of the Bible?', a: '"In the beginning God created the heavens and the earth." (Genesis 1:1)' },
    { q: 'How many days did God take to create the world?', a: 'Six days — He rested on the seventh day.' },
    { q: 'Who was the first king of Israel?', a: 'Saul — anointed by the prophet Samuel.' },
    { q: 'What is the last book of the Bible?', a: 'Revelation — written by the Apostle John.' },
    { q: 'Who was thrown into the lion\'s den?', a: 'Daniel — and God sent an angel to shut the lions\' mouths.' },
    { q: 'What did Moses receive on Mount Sinai?', a: 'The Ten Commandments — written on stone tablets by God.' },
    { q: 'Who betrayed Jesus?', a: 'Judas Iscariot — for 30 pieces of silver.' },
    { q: 'How many apostles did Jesus choose?', a: '12 apostles — who became the foundation of the early church.' },
    { q: 'Who denied Jesus three times?', a: 'Peter — just as Jesus had predicted.' },
    { q: 'What was Jesus\' first miracle?', a: 'Turning water into wine at the wedding in Cana.' },
    { q: 'Who was swallowed by a great fish?', a: 'Jonah — after trying to flee from God\'s command.' },
    { q: 'What is the Golden Rule?', a: '"Do unto others as you would have them do unto you." (Matthew 7:12)' },
    { q: 'Which two cities did God destroy?', a: 'Sodom and Gomorrah — because of their great wickedness.' },
    { q: 'Who wrote most of the Psalms?', a: 'King David — he wrote approximately 73 of the 150 Psalms.' },
    { q: 'What river was Jesus baptized in?', a: 'The Jordan River — by John the Baptist.' },
    { q: 'Who was the wisest man in the Bible?', a: 'King Solomon — God granted him extraordinary wisdom.' },
    { q: 'What did God create on the fourth day?', a: 'The sun, moon, and stars.' },
    { q: 'Who interpreted Pharaoh\'s dreams?', a: 'Joseph — predicting seven years of plenty and seven of famine.' },
    { q: 'What was Paul\'s name before conversion?', a: 'Saul of Tarsus — he persecuted Christians before meeting Jesus on the road to Damascus.' },
    { q: 'How old was Jesus when He began His ministry?', a: 'About 30 years old (Luke 3:23).' },
    { q: 'Who helped carry the cross for Jesus?', a: 'Simon of Cyrene — the Roman soldiers forced him.' },
    { q: 'What is the shortest book in the Bible?', a: '3 John — with only one chapter and 219 words in Greek.' },
    { q: 'Who climbed a tree to see Jesus?', a: 'Zacchaeus — a short tax collector who climbed a sycamore tree.' },
  ];

  const getRotatingIndex = (arr, intervalMs = 3600000) => {
    const hour = Math.floor(Date.now() / intervalMs);
    return hour % arr.length;
  };

  const currentVerse = bibleVerses[getRotatingIndex(bibleVerses)];
  const currentFact = bibleFacts[getRotatingIndex(bibleFacts, 7200000)];
  const currentTrivia = bibleTrivia[getRotatingIndex(bibleTrivia, 5400000)];

  // -- Messages --
  const handleSendMessage = async () => {
    const body = { senderId: userData?.id, ...messageForm };
    const res = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) { showToast(data.message, 'success'); setShowMessageForm(false); setMessageForm({ receiverId: '', subject: '', content: '', isBroadcast: false, broadcastTarget: 'all' }); loadMessages(); }
  };

  // -- Attendance (Admin) --
  const handleMarkAttendance = async (userId, status) => {
    const res = await fetch('/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, eventDate: attendanceDate, status, markedBy: userData?.id }) });
    const data = await res.json();
    if (data.success) { showToast('Attendance marked', 'success'); loadAttendance(); }
  };

  // -- Admin: User Management --
  const handleCreateUser = async () => {
    try {
      const res = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userForm) });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); setShowUserForm(false); setUserForm({ firstname: '', lastname: '', email: '', password: '', ministry: '', sub_role: '', role: 'Guest' }); loadAdminUsers(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleEditUser = (user) => {
    setEditingUser(user);
    setUserForm({ firstname: user.firstname, lastname: user.lastname, email: user.email, password: '', ministry: user.ministry || '', sub_role: user.sub_role || '', role: user.role || 'Guest' });
    setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
    try {
      const updates = { id: editingUser.id, firstname: userForm.firstname, lastname: userForm.lastname, ministry: userForm.ministry, sub_role: userForm.sub_role, role: userForm.role };
      const res = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
      const data = await res.json();
      if (data.success) { showToast('User updated successfully!', 'success'); setShowEditModal(false); setEditingUser(null); setUserForm({ firstname: '', lastname: '', email: '', password: '', ministry: '', sub_role: '', role: 'Guest' }); loadAdminUsers(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const handleUserAction = async (userId, action, extra = {}) => {
    const res = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: userId, action, ...extra }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) loadAdminUsers();
    setConfirmAction(null);
  };

  const handleDeleteUser = async (userId) => {
    const res = await fetch(`/api/admin/users?id=${userId}`, { method: 'DELETE' });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) loadAdminUsers();
    setConfirmAction(null);
  };

  const handleAdminResetPassword = async (userId) => {
    if (!resetPwForm.newPassword || resetPwForm.newPassword.length < 8) {
      showToast('Password must be at least 8 characters', 'danger'); return;
    }
    if (resetPwForm.newPassword !== resetPwForm.confirmPassword) {
      showToast('Passwords do not match', 'danger'); return;
    }
    const res = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: userId, action: 'reset-password', newPassword: resetPwForm.newPassword }) });
    const data = await res.json();
    showToast(data.message, data.success ? 'success' : 'danger');
    if (data.success) { setShowResetPwModal(null); setResetPwForm({ newPassword: '', confirmPassword: '' }); }
  };

  const filteredAdminUsers = adminUsers.filter(u => {
    const searchLower = userSearch.toLowerCase();
    const matchesSearch = !userSearch || 
      `${u.firstname} ${u.lastname}`.toLowerCase().includes(searchLower) ||
      u.email?.toLowerCase().includes(searchLower) ||
      u.member_id?.toLowerCase().includes(searchLower);
    const matchesRole = !userFilterRole || u.role === userFilterRole;
    const matchesMinistry = !userFilterMinistry || u.ministry === userFilterMinistry;
    const matchesStatus = !userFilterStatus || u.status === userFilterStatus;
    return matchesSearch && matchesRole && matchesMinistry && matchesStatus;
  });

  // -- Admin: Ministry Management --
  const handleMinistrySubmit = async () => {
    const res = await fetch('/api/admin/ministries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ministryForm) });
    const data = await res.json();
    if (data.success) { showToast(data.message, 'success'); setShowMinistryForm(false); setMinistryForm({ name: '', description: '' }); loadMinistries(); }
  };

  // ============================================
  // LINEUP HANDLERS
  // ============================================
  const loadBackupSingers = async () => {
    try {
      const res = await fetch('/api/lineup/singers?type=backupers');
      const data = await res.json();
      if (data.success) setBackupSingerOptions(data.data || []);
    } catch (e) { console.error('Failed to load backup singers:', e); }
  };

  const loadSongLeaders = async () => {
    try {
      const res = await fetch('/api/lineup/singers?type=song-leaders');
      const data = await res.json();
      if (data.success) setSongLeaderOptions(data.data || []);
    } catch (e) { console.error('Failed to load song leaders:', e); }
  };

  const isAdmin = userRole === 'Admin' || userRole === 'Super Admin';

  const handleLineupChange = (field, value) => setLineupForm((prev) => ({ ...prev, [field]: value }));
  // Backup singer: add by picking from dropdown (chip-based)
  const addBackupSingerByName = (name) => {
    if (!name) return;
    setLineupForm((p) => ({ ...p, backupSingers: [...p.backupSingers.filter(Boolean), name] }));
  };
  const removeBackupSinger = (name) => {
    setLineupForm((p) => ({ ...p, backupSingers: p.backupSingers.filter((s) => s !== name) }));
  };
  // Get available backup singers (exclude already selected + exclude current song leader + exclude excused)
  const getAvailableBackupSingers = () => {
    const selected = lineupForm.backupSingers.filter(Boolean);
    return backupSingerOptions.filter(b => {
      if (selected.includes(b.name)) return false;
      if (b.name === lineupForm.songLeader) return false;
      // Exclude excused backup singers for this date
      if (lineupForm.scheduleDate && getExcuseForMemberOnDate(b.name, lineupForm.scheduleDate, 'Backup Singer')) return false;
      return true;
    });
  };
  // When song leader changes, also remove them from backup singers if present
  const handleSongLeaderChange = (value) => {
    setLineupForm((prev) => ({
      ...prev,
      songLeader: value,
      backupSingers: prev.backupSingers.filter(s => s !== value),
    }));
  };
  const addSong = (type) => setLineupForm((p) => ({ ...p, [type]: [...p[type], { title: '', link: '', instructions: '' }] }));
  const removeSong = (type, i) => {
    setLineupForm((p) => ({ ...p, [type]: p[type].filter((_, idx) => idx !== i) }));
    setSongScanResults((prev) => { const n = { ...prev }; delete n[`${type}-${i}`]; return n; });
  };

  // AI Song Content Scanner
  const scanSongContent = async (type, index, title, link) => {
    const key = `${type}-${index}`;
    if (!title && !link) {
      setSongScanResults((prev) => { const n = { ...prev }; delete n[key]; return n; });
      return;
    }
    if (!title && !link) return; // Need at least a title or link to scan

    setSongScanResults((prev) => ({ ...prev, [key]: { status: 'scanning', message: 'AI is scanning this song...', details: '' } }));

    try {
      // Step 1: If YouTube link is provided, fetch the actual video title & channel
      let videoTitle = '';
      let videoChannel = '';
      if (link) {
        try {
          const ytId = link.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
          if (ytId) {
            const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytId[1]}`);
            const oembedData = await oembedRes.json();
            if (oembedData.title) videoTitle = oembedData.title;
            if (oembedData.author_name) videoChannel = oembedData.author_name;
          }
        } catch { /* could not fetch video info, continue with title only */ }
      }

      // Step 2: Build detailed context for AI
      let songContext = '';
      if (title) songContext += `User-entered song title: "${title}"\n`;
      if (videoTitle) songContext += `Actual YouTube video title: "${videoTitle}"\n`;
      if (videoChannel) songContext += `YouTube channel: "${videoChannel}"\n`;
      if (link) songContext += `YouTube link: ${link}\n`;

      const res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            {
              role: 'system',
              content: `You are a church worship song content reviewer. Your job is to analyze songs and determine if they are appropriate for church worship use.

You will receive the user-entered song title AND the actual YouTube video title (fetched from YouTube). Use BOTH to make your judgment. The YouTube title is more reliable — pay close attention to it.

Check for:
1. Explicit language (profanity, vulgar words, "explicit" tags)
2. Sexual content or innuendo
3. Violence, dark or harmful themes
4. Drug/alcohol glorification
5. Content that contradicts Christian worship values
6. If the YouTube title mentions "explicit", "18+", "parental advisory", or contains profanity — flag it immediately
7. If it's a well-known secular pop/rap/R&B/rock song NOT intended for worship — flag as warning

Respond ONLY with a valid JSON object (no markdown, no code fences, no extra text) in this exact format:
{"verdict": "safe" or "explicit" or "warning", "reason": "brief 1-sentence explanation", "youtubeTitle": "the actual YouTube title if available"}

- "safe" = song is appropriate for church worship (hymns, gospel, praise & worship)
- "explicit" = song has explicit/inappropriate content and should NOT be used in church
- "warning" = song is secular or has borderline content; the song leader should review before using`
            },
            {
              role: 'user',
              content: `Analyze this song for church worship use:\n${songContext}\nIs this appropriate for a church worship service?`
            }
          ],
          temperature: 0.1,
          max_tokens: 250,
        }),
      });

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content?.trim();

      if (content) {
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            const ytInfo = videoTitle ? `YouTube: "${videoTitle}"${videoChannel ? ` by ${videoChannel}` : ''}` : '';
            setSongScanResults((prev) => ({
              ...prev,
              [key]: {
                status: result.verdict || 'safe',
                message: result.verdict === 'safe' ? '✓ Appropriate for worship'
                  : result.verdict === 'explicit' ? '✕ Explicit content — not recommended'
                  : '⚠ Caution — review before using',
                details: result.reason + (ytInfo ? `\n${ytInfo}` : ''),
              }
            }));
            return;
          }
        } catch { /* fallback below */ }
      }
      setSongScanResults((prev) => ({ ...prev, [key]: { status: 'safe', message: '✓ No issues detected', details: videoTitle ? `YouTube: "${videoTitle}"` : '' } }));
    } catch {
      setSongScanResults((prev) => ({ ...prev, [key]: { status: 'error', message: 'Could not scan', details: 'AI scan failed. Please review manually.' } }));
    }
  };

  // Auto-fill song title from YouTube link using noembed + Groq AI
  const autoFillSongTitle = async (type, i, link) => {
    const fillKey = `${type}-${i}`;
    try {
      // Extract YouTube video ID
      const ytMatch = link.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (!ytMatch) return;

      setSongAutoFillLoading(prev => ({ ...prev, [fillKey]: true }));

      // Fetch video info from noembed
      const oembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytMatch[1]}`);
      const oembedData = await oembedRes.json();
      const videoTitle = oembedData.title || '';
      const videoChannel = oembedData.author_name || '';

      if (!videoTitle) {
        setSongAutoFillLoading(prev => { const n = { ...prev }; delete n[fillKey]; return n; });
        return;
      }

      // Use Groq AI to extract clean "SONG TITLE - ARTIST" from the YouTube title
      const aiRes = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            {
              role: 'system',
              content: `You extract the song title and artist from YouTube video titles. You MUST respond with ONLY the formatted result — no explanation, no quotes, no extra text.

Format: SONG TITLE - ARTIST

Rules:
- Output the song name first in UPPERCASE, then " - ", then the artist name in UPPERCASE
- Remove any extra info like "(Official Video)", "(Lyrics)", "(Live)", "[Official Music Video]", "HD", "Audio", "ft.", "feat.", etc.
- If the video title has "Artist - Song", reverse it to "SONG - ARTIST"
- If you cannot determine the artist from the title, use the YouTube channel name as the artist
- For worship/gospel songs, the artist is usually the worship leader or band name
- Keep featured artist info like "ft." out of the result

Examples:
- Input: "Don Moen - Our Father | Live Worship Sessions" by DonMoenTV → OUR FATHER - DON MOEN
- Input: "Friend of God - Israel Houghton (Official)" by Churchome → FRIEND OF GOD - ISRAEL HOUGHTON
- Input: "Planetshakers - Joy" by Planetshakers → JOY - PLANETSHAKERS
- Input: "Way Maker - Sinach [Official Video]" by Sinach → WAY MAKER - SINACH
- Input: "What A Beautiful Name - Hillsong Worship" by Hillsong → WHAT A BEAUTIFUL NAME - HILLSONG WORSHIP`
            },
            {
              role: 'user',
              content: `YouTube title: "${videoTitle}"\nYouTube channel: "${videoChannel}"\n\nExtract the song title and artist.`
            }
          ],
          temperature: 0.1,
          max_tokens: 80,
        }),
      });

      const aiData = await aiRes.json();
      const aiContent = aiData?.choices?.[0]?.message?.content?.trim();

      if (aiContent) {
        // Clean up any quotes or extra whitespace
        let cleanTitle = aiContent.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
        // Only use if it looks like a valid "TITLE - ARTIST" format
        if (cleanTitle.includes(' - ') && cleanTitle.length > 5 && cleanTitle.length < 120) {
          // Check if title is still empty (user may have typed something while we were loading)
          setLineupForm(prev => {
            const songs = [...prev[type]];
            if (!songs[i]?.title) {
              songs[i] = { ...songs[i], title: cleanTitle };
              // Trigger scan after auto-fill
              setTimeout(() => scanSongContent(type, i, cleanTitle, link), 300);
              return { ...prev, [type]: songs };
            }
            return prev;
          });
        }
      }
    } catch { /* silent — auto-fill is a nice-to-have */ }
    setSongAutoFillLoading(prev => { const n = { ...prev }; delete n[fillKey]; return n; });
  };

  // Debounced song change handler — triggers AI scan when title or link changes
  const handleSongChange = (type, i, field, value) => {
    const s = [...lineupForm[type]]; s[i] = { ...s[i], [field]: value }; setLineupForm((p) => ({ ...p, [type]: s }));

    // Auto-scan when title or link changes
    if (field === 'title' || field === 'link') {
      const timerKey = `${type}-${i}`;
      if (songScanTimers.current[timerKey]) clearTimeout(songScanTimers.current[timerKey]);

      const updatedSong = { ...s[i], [field]: value };

      // Auto-fill title from YouTube link when title is empty
      if (field === 'link' && !updatedSong.title && value) {
        const ytId = value.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        if (ytId) autoFillSongTitle(type, i, value);
      }

      // Trigger scan if there's a title OR a YouTube link
      if (updatedSong.title || updatedSong.link) {
        songScanTimers.current[timerKey] = setTimeout(() => {
          scanSongContent(type, i, updatedSong.title, updatedSong.link);
        }, 1200); // Wait 1.2s after user stops typing
      } else {
        // Clear scan if both title and link are removed
        setSongScanResults((prev) => { const n = { ...prev }; delete n[timerKey]; return n; });
      }
    }
  };

  // Manual re-scan trigger
  const rescanSong = (type, i) => {
    const song = lineupForm[type][i];
    if (song?.title || song?.link) scanSongContent(type, i, song.title, song.link);
  };

  const resetLineupForm = () => {
    setLineupForm({ scheduleDate: '', practiceDate: '', practiceTime: '', songLeader: '', backupSingers: [], slowSongs: [{ title: '', link: '', instructions: '' }], fastSongs: [{ title: '', link: '', instructions: '' }] });
    setLineupSelectedDate(null);
    setLineupView('calendar');
    setEditingLineup(null);
    setSongScanResults({});
    setLineupDetailPopup(null);
    setLineupViewingAssignment(null);
  };

  const handleLineupDateSelect = (dateStr) => {
    if (isAdmin) {
      // Admin: check if lineup already exists for this date
      const existing = scheduleData.find(s => s.scheduleDate === dateStr);
      if (existing) {
        showToast('A lineup already exists for this date. Switch to All Assignments to edit it.', 'warning');
        return;
      }
      setLineupSelectedDate(dateStr);
      setLineupForm(prev => ({ ...prev, scheduleDate: dateStr, songLeader: '', backupSingers: [] }));
      loadBackupSingers();
      loadSongLeaders();
    } else {
      // Song Leader: can only click their assigned dates
      const existing = scheduleData.find(s => s.scheduleDate === dateStr);
      if (!existing) return;
      const myName = userData ? `${userData.firstname} ${userData.lastname}` : '';
      const isMySubDate = isSubstituteDateForMe(dateStr);
      // Check if this SL has an accepted sub for this date (they requested a sub and it was accepted)
      const myAcceptedSub = getSubForDate(dateStr);
      const isMySubbedDate = myAcceptedSub && myAcceptedSub.status === 'Accepted' && myAcceptedSub.requester_id === userData?.id;
      if (isMySubbedDate) {
        // Original SL who requested the sub → show read-only popup with sub's name
        setLineupDetailPopup({
          songLeader: existing.songLeader,
          backupSingers: existing.backupSingers || [],
          date: dateStr,
          slowSongs: existing.slowSongs || [],
          fastSongs: existing.fastSongs || [],
          substitutedBy: myAcceptedSub.substitute_name,
        });
        return;
      }
      if (existing.songLeader !== myName && !isMySubDate) {
        // Show detail popup for this date
        setLineupDetailPopup({ songLeader: existing.songLeader, backupSingers: existing.backupSingers || [], date: dateStr, slowSongs: existing.slowSongs || [], fastSongs: existing.fastSongs || [] });
        return;
      }
      // This is their assigned date OR their sub date — open form to add/edit songs
      setLineupSelectedDate(dateStr);
      setEditingLineup(existing);
      // Auto-fill practice date to the Saturday before the schedule date
      let autoPracticeDate = existing.practiceDate || '';
      if (!autoPracticeDate && existing.scheduleDate) {
        const schedDate = new Date(existing.scheduleDate + 'T00:00:00');
        const dayOfWeek = schedDate.getDay(); // 0=Sun, 6=Sat
        const daysBack = dayOfWeek === 0 ? 1 : dayOfWeek === 6 ? 0 : (dayOfWeek + 1);
        const satDate = new Date(schedDate);
        satDate.setDate(satDate.getDate() - daysBack);
        autoPracticeDate = `${satDate.getFullYear()}-${String(satDate.getMonth()+1).padStart(2,'0')}-${String(satDate.getDate()).padStart(2,'0')}`;
      }
      setLineupForm({
        scheduleDate: existing.scheduleDate,
        practiceDate: autoPracticeDate,
        practiceTime: existing.practiceTime || '',
        songLeader: existing.songLeader,
        backupSingers: existing.backupSingers?.length ? [...existing.backupSingers] : [],
        slowSongs: existing.slowSongs?.length ? existing.slowSongs : [{ title: '', link: '', instructions: '' }],
        fastSongs: existing.fastSongs?.length ? existing.fastSongs : [{ title: '', link: '', instructions: '' }],
      });
      setLineupView('form');
    }
  };

  const submitLineup = async () => {
    if (!lineupForm.scheduleDate) { showToast('Schedule date is required', 'warning'); return; }

    // Admin only assigns — no songs required
    if (isAdmin) {
      if (!lineupForm.songLeader) { showToast('Please select a Song Leader', 'warning'); return; }
    } else {
      // Song Leader must add at least one song
      if (!lineupForm.slowSongs.some(s => s.title) && !lineupForm.fastSongs.some(s => s.title)) { showToast('Please add at least one song', 'warning'); return; }
    }

    const songLeaderName = lineupForm.songLeader || (userData ? `${userData.firstname} ${userData.lastname}` : '');
    if (!songLeaderName) { showToast('Please select a Song Leader', 'warning'); return; }

    // Find song leader's ID for notifications (admin created lineups)
    let songLeaderId = null;
    if (isAdmin) {
      const leaderMatch = songLeaderOptions.find(sl => sl.name === songLeaderName);
      if (leaderMatch) songLeaderId = leaderMatch.id;
    }

    setLineupLoading(true);
    try {
      const isEditing = !!editingLineup;
      const res = await fetch('/api/schedules', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEditing && { scheduleId: editingLineup.scheduleId }),
          songLeader: songLeaderName, scheduleDate: lineupForm.scheduleDate,
          practiceDate: lineupForm.practiceDate || null, practiceTime: lineupForm.practiceTime || null,
          backupSingers: lineupForm.backupSingers.filter(Boolean),
          slowSongs: lineupForm.slowSongs.filter((s) => s.title), fastSongs: lineupForm.fastSongs.filter((s) => s.title),
          submittedBy: userData?.email,
          songLeaderId: songLeaderId,
          notifyLeader: isAdmin && songLeaderId ? true : false,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLineupView('success');
        loadScheduleData();
        setTimeout(() => { resetLineupForm(); }, 3000);
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setLineupLoading(false); }
  };

  const deleteLineup = async (scheduleId) => {
    try {
      const res = await fetch(`/api/schedules?scheduleId=${scheduleId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showToast('Lineup deleted successfully!', 'success'); loadScheduleData(); setDeleteConfirmId(null); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const startEditLineup = (lineup) => {
    setEditingLineup(lineup);
    // Auto-fill practice date to Saturday before schedule date if not set
    let autoPracticeDate = lineup.practiceDate || '';
    if (!autoPracticeDate && lineup.scheduleDate) {
      const schedDate = new Date(lineup.scheduleDate + 'T00:00:00');
      const dayOfWeek = schedDate.getDay();
      const daysBack = dayOfWeek === 0 ? 1 : dayOfWeek === 6 ? 0 : (dayOfWeek + 1);
      const satDate = new Date(schedDate);
      satDate.setDate(satDate.getDate() - daysBack);
      autoPracticeDate = `${satDate.getFullYear()}-${String(satDate.getMonth()+1).padStart(2,'0')}-${String(satDate.getDate()).padStart(2,'0')}`;
    }
    setLineupForm({
      scheduleDate: lineup.scheduleDate, practiceDate: autoPracticeDate,
      practiceTime: lineup.practiceTime || '',
      songLeader: lineup.songLeader || '', backupSingers: lineup.backupSingers?.length ? [...lineup.backupSingers] : [],
      slowSongs: lineup.slowSongs?.length ? lineup.slowSongs : [{ title: '', link: '', instructions: '' }],
      fastSongs: lineup.fastSongs?.length ? lineup.fastSongs : [{ title: '', link: '', instructions: '' }],
    });
    setLineupSelectedDate(lineup.scheduleDate);
    setLineupTab('assign');
    if (isAdmin) {
      setLineupView('calendar'); // admin uses split layout, not 'form' view
      loadBackupSingers(); loadSongLeaders();
    } else {
      setLineupView('form');
    }
  };

  // Get lineups: admin sees all, song leader sees own + sub dates
  const getMyLineups = () => {
    if (isAdmin) {
      return scheduleData.sort((a, b) => new Date(b.scheduleDate) - new Date(a.scheduleDate));
    }
    const mySubDates = getAcceptedSubsAsSubstitute().map(s => s.schedule_date);
    return scheduleData.filter(s => s.submittedBy === userData?.email || s.songLeader === `${userData?.firstname} ${userData?.lastname}` || mySubDates.includes(s.scheduleDate)).sort((a, b) => new Date(b.scheduleDate) - new Date(a.scheduleDate));
  };

  // Get dates where current user is assigned as Song Leader (for calendar highlight)
  const getAssignedDates = () => {
    if (!userData) return [];
    const myName = `${userData.firstname} ${userData.lastname}`;
    // Include dates where I'm the song_leader AND dates where I was the original requester (now substituted)
    const scheduledDates = scheduleData.filter(s => s.songLeader === myName).map(s => s.scheduleDate);
    const subbedDates = subRequests
      .filter(s => s.requester_id === userData.id && (s.status === 'Accepted' || s.status === 'Open for Sub' || s.status === 'Pending Admin'))
      .map(s => s.schedule_date);
    return [...new Set([...scheduledDates, ...subbedDates])];
  };

  // Get backup singers for a date where current user is assigned as Song Leader
  const getAssignedBackups = (dateStr) => {
    const schedule = scheduleData.find(s => s.scheduleDate === dateStr);
    return schedule?.backupSingers || [];
  };

  // Lineup calendar helpers
  const getLineupCalendarDays = () => {
    const year = lineupCalendarMonth.getFullYear();
    const month = lineupCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  };

  const isLineupDateTaken = (day) => {
    if (!day) return false;
    const dateStr = `${lineupCalendarMonth.getFullYear()}-${String(lineupCalendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return scheduleData.some(s => s.scheduleDate === dateStr);
  };

  const isLineupDatePast = (day) => {
    if (!day) return false;
    const date = new Date(lineupCalendarMonth.getFullYear(), lineupCalendarMonth.getMonth(), day);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return date < today;
  };

  // ============================================
  // LINEUP EXCUSES
  // ============================================
  const loadLineupExcuses = async () => {
    try {
      const params = isAdmin ? '?all=true' : `?userId=${userData?.id}`;
      const res = await fetch(`/api/lineup/excuses${params}`);
      const data = await res.json();
      if (data.success) setLineupExcuses(data.data || []);
    } catch { /* silent */ }
  };

  const submitExcuse = async (overrideRoleType) => {
    if (!excuseModalDate || !excuseReason.trim()) { showToast('Please select a date and provide a reason', 'warning'); return; }
    setExcuseLoading(true);
    try {
      const userSubRole = userData?.sub_role || '';
      const detectedRole = overrideRoleType || excuseModalRoleType || (userSubRole.includes('Song Leaders') ? 'Song Leader' : userSubRole.includes('Backup Singer') ? 'Backup Singer' : userSubRole.includes('Instrumentalist') ? 'Instrumentalist' : userSubRole.includes('Dancer') ? 'Dancer' : userSubRole.includes('Media') ? 'Media' : 'Song Leader');
      const res = await fetch('/api/lineup/excuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userData?.id,
          userName: `${userData?.firstname} ${userData?.lastname}`,
          excuseDate: excuseModalDate,
          reason: excuseReason.trim(),
          roleType: detectedRole,
          profilePicture: userData?.profile_picture || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Excuse submitted! Waiting for admin approval.', 'success');
        setExcuseModalDate(null);
        setExcuseModalRoleType(null);
        setExcuseReason('');
        loadLineupExcuses();
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setExcuseLoading(false); }
  };

  const cancelExcuse = async (excuseId) => {
    try {
      const res = await fetch(`/api/lineup/excuses?id=${excuseId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showToast('Excuse cancelled', 'success'); loadLineupExcuses(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const reviewExcuse = async (excuseId, status) => {
    try {
      const res = await fetch('/api/lineup/excuses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: excuseId, status, reviewedBy: userData?.email }),
      });
      const data = await res.json();
      if (data.success) { showToast(`Excuse ${status.toLowerCase()}!`, 'success'); loadLineupExcuses(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  // Check if a Song Leader is excused on a specific date (for admin dropdown graying)
  const getExcuseForLeaderOnDate = (leaderName, dateStr) => {
    return lineupExcuses.find(e => e.user_name === leaderName && e.excuse_date === dateStr && (e.status === 'Approved' || e.status === 'Pending'));
  };

  // Check if a backup singer / instrumentalist / dancer has an excuse for a date
  const getExcuseForMemberOnDate = (memberName, dateStr, roleType) => {
    return lineupExcuses.find(e => e.user_name === memberName && e.excuse_date === dateStr && (e.role_type || '') === roleType && (e.status === 'Approved' || e.status === 'Pending'));
  };

  // Get current month's assigned dates that are missing songs (for Song Leader cards)
  const getAssignedDatesMissingSongs = () => {
    if (!userData) return [];
    const myName = `${userData.firstname} ${userData.lastname}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Dates where user has a sub request (don't nag about songs)
    const subDates = subRequests
      .filter(s => s.requester_id === userData.id && (s.status === 'Accepted' || s.status === 'Open for Sub' || s.status === 'Pending Admin'))
      .map(s => s.schedule_date);
    return scheduleData.filter(s => {
      if (s.songLeader !== myName) return false;
      if (new Date(s.scheduleDate + 'T00:00:00') < today) return false;
      if (subDates.includes(s.scheduleDate)) return false;
      const hasSongs = (s.slowSongs?.length > 0 && s.slowSongs.some(ss => ss.title)) || (s.fastSongs?.length > 0 && s.fastSongs.some(ss => ss.title));
      return !hasSongs;
    });
  };

  // Get my excuses for display
  const getMyExcuses = () => {
    if (!userData) return [];
    return lineupExcuses.filter(e => e.user_id === userData.id).sort((a, b) => new Date(a.excuse_date) - new Date(b.excuse_date));
  };

  // Get pending excuses (for admin notification)
  const getPendingExcuses = () => {
    return lineupExcuses.filter(e => e.status === 'Pending').sort((a, b) => new Date(a.excuse_date) - new Date(b.excuse_date));
  };

  // Check if a date has an excuse for current user
  const getMyExcuseForDate = (dateStr) => {
    if (!userData) return null;
    return lineupExcuses.find(e => e.user_id === userData.id && e.excuse_date === dateStr);
  };

  // ============================================
  // LINEUP SUBSTITUTES
  // ============================================
  const loadSubRequests = async () => {
    try {
      // Both admin and Song Leaders need all subs: admin to review, SL to see open requests + their own
      const res = await fetch('/api/lineup/substitutes?all=true');
      const data = await res.json();
      if (data.success) setSubRequests(data.data || []);
    } catch { /* silent */ }
  };

  const submitSubRequest = async () => {
    if (!subModalDate || !subReason.trim()) { showToast('Please provide a reason for the substitute request', 'warning'); return; }
    setSubLoading(true);
    try {
      const schedule = scheduleData.find(s => s.scheduleDate === subModalDate);
      const userSubRole = userData?.sub_role || '';
      const detectedRole = subModalRoleType || (userSubRole.includes('Song Leaders') ? 'Song Leader' : userSubRole.includes('Backup Singer') ? 'Backup Singer' : userSubRole.includes('Instrumentalist') ? 'Instrumentalist' : userSubRole.includes('Dancer') ? 'Dancer' : 'Song Leader');
      const res = await fetch('/api/lineup/substitutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId: userData?.id,
          requesterName: `${userData?.firstname} ${userData?.lastname}`,
          requesterProfilePicture: userData?.profile_picture || null,
          scheduleId: schedule?.scheduleId || subModalScheduleId || null,
          scheduleDate: subModalDate,
          reason: subReason.trim(),
          roleType: detectedRole,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Substitute request submitted! Waiting for admin approval.', 'success');
        setSubModalDate(null); setSubModalScheduleId(null); setSubModalRoleType(null); setSubReason('');
        loadSubRequests();
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setSubLoading(false); }
  };

  const adminReviewSub = async (subId, action) => {
    try {
      // Find the sub request to get its role_type
      const subReq = subRequests.find(s => s.id === subId);
      const roleType = subReq?.role_type || 'Song Leader';
      // Get member IDs matching the same role for notifications
      let notifyIds = [];
      if (roleType === 'Song Leader') {
        notifyIds = songLeaderOptions.map(sl => sl.id);
      } else {
        // Find members from pawAllMembers matching the role's sub_role keyword
        const roleKeyword = roleType === 'Backup Singer' ? 'Backup Singer' : roleType === 'Instrumentalist' ? 'Instrumentalist' : roleType === 'Dancer' ? 'Dancer' : roleType;
        notifyIds = pawAllMembers.filter(m => (m.sub_role || '').includes(roleKeyword)).map(m => m.id);
      }
      const res = await fetch('/api/lineup/substitutes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: subId,
          action: action === 'approve' ? 'admin-approve' : 'admin-reject',
          reviewedBy: userData?.email,
          songLeaderIds: roleType === 'Song Leader' ? notifyIds : undefined,
          memberIds: roleType !== 'Song Leader' ? notifyIds : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); loadSubRequests(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const acceptSubRequest = async (subId) => {
    try {
      const res = await fetch('/api/lineup/substitutes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: subId,
          action: 'accept',
          substituteId: userData?.id,
          substituteName: `${userData?.firstname} ${userData?.lastname}`,
          substituteProfilePicture: userData?.profile_picture || null,
        }),
      });
      const data = await res.json();
      if (data.success) { showToast(data.message, 'success'); loadSubRequests(); loadScheduleData(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const cancelSubRequest = async (subId) => {
    try {
      const res = await fetch(`/api/lineup/substitutes?id=${subId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) { showToast('Sub request cancelled.', 'success'); loadSubRequests(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  const sendSubThankYou = async () => {
    if (!subThankYouModal) return;
    try {
      const res = await fetch('/api/lineup/substitutes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: subThankYouModal.subId,
          action: 'thank-you',
          thankYouMessage: subThankYouMessage.trim() || 'Thank you for substituting! God bless you! 🙏',
        }),
      });
      const data = await res.json();
      if (data.success) { showToast('Thank you message sent! 💛', 'success'); setSubThankYouModal(null); setSubThankYouMessage(''); loadSubRequests(); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); }
  };

  // Helpers for substitute data
  const getSubForDate = (dateStr, roleType) => {
    return subRequests.find(s => s.schedule_date === dateStr && s.requester_id === userData?.id && s.status !== 'Cancelled' && s.status !== 'Rejected' && (!roleType || (s.role_type || 'Song Leader') === roleType));
  };

  const getMySubRequests = () => {
    if (!userData) return [];
    return subRequests.filter(s => s.requester_id === userData.id).sort((a, b) => new Date(a.schedule_date) - new Date(b.schedule_date));
  };

  const getOpenSubsForMe = () => {
    if (!userData) return [];
    // Determine user's PAW role keyword
    const userSubRole = userData.sub_role || '';
    const userRoleType = userSubRole.includes('Song Leaders') ? 'Song Leader' : userSubRole.includes('Backup Singer') ? 'Backup Singer' : userSubRole.includes('Instrumentalist') ? 'Instrumentalist' : userSubRole.includes('Dancer') ? 'Dancer' : null;
    return subRequests.filter(s => {
      if (s.status !== 'Open for Sub') return false;
      if (s.requester_id === userData.id) return false;
      // Only show open subs matching user's role
      const subRole = s.role_type || 'Song Leader';
      if (userRoleType && subRole !== userRoleType) return false;
      return true;
    }).sort((a, b) => new Date(a.schedule_date) - new Date(b.schedule_date));
  };

  const getPendingAdminSubs = () => {
    return subRequests.filter(s => s.status === 'Pending Admin').sort((a, b) => new Date(a.schedule_date) - new Date(b.schedule_date));
  };

  const getAcceptedSubsAsSubstitute = () => {
    if (!userData) return [];
    return subRequests.filter(s => s.status === 'Accepted' && s.substitute_id === userData.id).sort((a, b) => new Date(a.schedule_date) - new Date(b.schedule_date));
  };

  const isSubstituteDateForMe = (dateStr) => {
    if (!userData) return false;
    return subRequests.some(s => s.schedule_date === dateStr && s.substitute_id === userData.id && s.status === 'Accepted');
  };

  const getAcceptedSubForDate = (dateStr) => {
    return subRequests.find(s => s.schedule_date === dateStr && s.status === 'Accepted');
  };

  // Admin: get sub stats for PAW Logs
  const getPawSubStats = () => {
    const pending = subRequests.filter(s => s.status === 'Pending Admin').length;
    const open = subRequests.filter(s => s.status === 'Open for Sub').length;
    const accepted = subRequests.filter(s => s.status === 'Accepted').length;
    const rejected = subRequests.filter(s => s.status === 'Rejected').length;
    return { pending, open, accepted, rejected, total: subRequests.length };
  };

  // Admin: filtered subs for PAW Logs
  const getFilteredPawSubs = () => {
    let list = [...subRequests];
    if (pawLogsFilter !== 'All') {
      const filterMap = { 'Pending': 'Pending Admin', 'Approved': 'Accepted', 'Rejected': 'Rejected' };
      const mapped = filterMap[pawLogsFilter];
      if (mapped) list = list.filter(s => s.status === mapped);
      else if (pawLogsFilter === 'Open') list = list.filter(s => s.status === 'Open for Sub');
    }
    if (pawLogsSearch.trim()) {
      const q = pawLogsSearch.toLowerCase();
      list = list.filter(s =>
        s.requester_name?.toLowerCase().includes(q) ||
        s.substitute_name?.toLowerCase().includes(q) ||
        s.reason?.toLowerCase().includes(q) ||
        s.schedule_date?.includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  };

  // ============================================
  // PAW LOGS HELPERS
  // ============================================
  const PAW_ROLE_TYPES = ['Song Leader', 'Backup Singer', 'Instrumentalist', 'Dancer', 'Media'];
  const PAW_ROLE_ICONS = { 'Song Leader': 'fa-microphone', 'Backup Singer': 'fa-users', 'Instrumentalist': 'fa-guitar', 'Dancer': 'fa-person-running', 'Media': 'fa-camera' };
  const PAW_ROLE_COLORS = { 'Song Leader': '#926c15', 'Backup Singer': '#0069d9', 'Instrumentalist': '#673ab7', 'Dancer': '#e91e63', 'Media': '#00897b' };

  const loadPawMembers = async () => {
    try {
      const res = await fetch('/api/lineup/singers?type=all-paw');
      const data = await res.json();
      if (data.success) setPawAllMembers(data.data || []);
    } catch { /* silent */ }
  };

  // Filtered excuses for PAW Logs tab
  const getFilteredPawExcuses = () => {
    let list = [...lineupExcuses];
    // Status filter
    if (pawLogsFilter !== 'All') {
      list = list.filter(e => e.status === pawLogsFilter);
    }
    // Role filter
    if (pawLogsRoleFilter !== 'All') {
      list = list.filter(e => (e.role_type || 'Song Leader') === pawLogsRoleFilter);
    }
    // Search filter
    if (pawLogsSearch.trim()) {
      const q = pawLogsSearch.toLowerCase();
      list = list.filter(e =>
        e.user_name?.toLowerCase().includes(q) ||
        e.reason?.toLowerCase().includes(q) ||
        e.excuse_date?.includes(q) ||
        (e.role_type || 'Song Leader').toLowerCase().includes(q)
      );
    }
    return list;
  };

  // Stats for PAW logs
  const getPawExcuseStats = () => {
    const pending = lineupExcuses.filter(e => e.status === 'Pending').length;
    const approved = lineupExcuses.filter(e => e.status === 'Approved').length;
    const rejected = lineupExcuses.filter(e => e.status === 'Rejected').length;
    return { pending, approved, rejected, total: lineupExcuses.length };
  };

  // Get profile picture for a user from pawAllMembers or from the excuse itself
  const getExcuseProfilePic = (excuse) => {
    if (excuse.profile_picture) return excuse.profile_picture;
    const member = pawAllMembers.find(m => m.id === excuse.user_id);
    return member?.profile_picture || null;
  };

  // Get initials from name
  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  // BIBLE READER & CHAT (from original)
  // ============================================
  const loadBibleChapter = async (book, chapter, verse, version) => {
    const b = book || bibleBook;
    const c = chapter || bibleChapter;
    const v = verse || bibleVerse;
    const ver = version || bibleVersion;
    setBibleText('Loading...');
    setBibleAnswer('');
    const verseReq = v ? ` verse ${v}` : '';
    const versionLabel = BIBLE_VERSIONS.find(bv => bv.value === ver)?.fullName || ver;
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `You are a Bible text provider. Provide the full text of the requested Bible chapter or verse. Use the ${versionLabel} translation. Include verse numbers. If the translation is Cebuano, provide the Cebuano version (Ang Pulong Sa Dios or similar). If Tagalog, provide the Tagalog version (Ang Salita ng Dios or similar). Be accurate to the requested translation.` }, { role: 'user', content: `Provide the full text of ${b} chapter ${c}${verseReq} in the ${versionLabel} translation.` }], temperature: 0.1, max_tokens: 4000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setBibleText(content || 'Error loading chapter. Please try again.');
    } catch { setBibleText('Error loading chapter. Please try again.'); }
  };

  // Get verse count for a specific book and chapter
  const getVerseCount = (book, chapter) => {
    const chapters = VERSES_PER_CHAPTER[book];
    if (!chapters || chapter < 1 || chapter > chapters.length) return 30; // fallback
    return chapters[chapter - 1];
  };

  // Direct scripture lookup: e.g. "Ephesians 6:1" or "1 John 3:16"
  const loadDirectScripture = () => {
    if (!directScripture.trim()) return;
    const match = directScripture.trim().match(/^(\d?\s?[A-Za-z\s]+?)\s+(\d+)(?::(\d+(?:-\d+)?))?$/i);
    if (!match) { setBibleText('Invalid format. Try: "Ephesians 6:1" or "John 3:16-17"'); return; }
    const bookName = match[1].trim();
    const chap = parseInt(match[2]);
    const verse = match[3] || '';
    // Find matching book
    const found = Object.keys(BIBLE_BOOKS).find(b => b.toLowerCase() === bookName.toLowerCase());
    if (!found) { setBibleText(`Book "${bookName}" not found. Check spelling.`); return; }
    setBibleBook(found);
    setBibleChapter(chap);
    setBibleVerse(verse);
    loadBibleChapter(found, chap, verse);
  };

  const askBibleQuestionHandler = async () => {
    if (!bibleQuestion.trim()) return;
    setBibleAnswer('Thinking...');
    setAnswerCopied(false);
    const versionLabel = BIBLE_VERSIONS.find(bv => bv.value === bibleVersion)?.fullName || bibleVersion;
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `Answer questions about ${bibleBook} ${bibleChapter} (${versionLabel} translation). Be biblical and insightful. Use markdown headings (**Context:**, **Meaning:**, **Application:**). Keep it well structured.` }, { role: 'user', content: bibleQuestion }], temperature: 0.7, max_tokens: 1000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      setBibleAnswer(content || 'Error. Please try again.');
    } catch { setBibleAnswer('Error. Please try again.'); }
  };

  const copyBibleAnswer = () => {
    if (!bibleAnswer) return;
    navigator.clipboard.writeText(bibleAnswer).then(() => {
      setAnswerCopied(true);
      setTimeout(() => setAnswerCopied(false), 2000);
    });
  };

  // Highlight-to-Ask: detect text selection in Bible text
  useEffect(() => {
    const handleSelection = (e) => {
      // Don't dismiss popup if clicking the Ask button itself
      if (e.target.closest && e.target.closest('.highlight-ask-btn')) return;
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      if (selectedText && bibleTextRef.current && bibleTextRef.current.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const parentRect = bibleTextRef.current.getBoundingClientRect();
        setHighlightPopup({
          visible: true,
          x: rect.left - parentRect.left + rect.width / 2,
          y: rect.top - parentRect.top - 10,
          text: selectedText,
        });
      } else if (!selectedText) {
        // Only hide if there's no selection at all
        setTimeout(() => {
          const sel = window.getSelection();
          if (!sel || !sel.toString().trim()) {
            setHighlightPopup(prev => prev.visible ? { ...prev, visible: false } : prev);
          }
        }, 200);
      }
    };
    document.addEventListener('mouseup', handleSelection);
    document.addEventListener('touchend', handleSelection);
    return () => {
      document.removeEventListener('mouseup', handleSelection);
      document.removeEventListener('touchend', handleSelection);
    };
  }, []);

  const askHighlightedText = () => {
    if (!highlightPopup.text) return;
    const question = `Explain this scripture: "${highlightPopup.text}"`;
    setBibleQuestion(question);
    setHighlightPopup({ visible: false, x: 0, y: 0, text: '' });
    window.getSelection()?.removeAllRanges();
    setAnswerCopied(false);
    setBibleAnswer('Thinking...');
    const versionLabel = BIBLE_VERSIONS.find(bv => bv.value === bibleVersion)?.fullName || bibleVersion;
    fetch(GROQ_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `Answer questions about ${bibleBook} ${bibleChapter} (${versionLabel} translation). Be biblical and insightful. Use markdown headings (**Context:**, **Meaning:**, **Application:**). Keep it well structured.` }, { role: 'user', content: question }], temperature: 0.7, max_tokens: 1000 }),
    }).then(r => r.json()).then(data => {
      setBibleAnswer(data?.choices?.[0]?.message?.content || 'Error. Please try again.');
    }).catch(() => setBibleAnswer('Error. Please try again.'));
  };

  const fetchDailyQuote = async () => {
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: 'Generate an inspiring Christian quote. Format: QUOTE|AUTHOR' }, { role: 'user', content: 'Give me one inspiring Christian quote for today.' }], temperature: 0.9, max_tokens: 200 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('No response');
      const parts = content.split('|');
      setDailyQuote({ quote: parts[0]?.trim() || 'Faith is taking the first step even when you don\'t see the whole staircase.', author: parts[1]?.trim() || 'Martin Luther King Jr.' });
    } catch { setDailyQuote({ quote: 'Faith is taking the first step even when you don\'t see the whole staircase.', author: 'Martin Luther King Jr.' }); }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages((p) => [...p, { role: 'user', content: msg }]);
    setChatLoading(true);
    try {
      // Build conversation history from memory (last 20 messages for context)
      const historyMessages = chatMessages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [
          { role: 'system', content: `You are a compassionate Christian spiritual AI advisor for ${userData?.firstname || 'a believer'} who serves in ${userData?.ministry || 'ministry'}. Provide biblical guidance, prayer support, and encouragement. Use Scripture references when appropriate. You have memory of previous conversations with this user — use the conversation history to provide personalized and contextual responses. Always remind yourself: you are an AI assistant; encourage the user to also seek God directly through prayer and His Word.` },
          ...historyMessages,
          { role: 'user', content: msg }
        ], temperature: 0.7, max_tokens: 1000 }),
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('No response');
      setChatMessages((p) => [...p, { role: 'assistant', content }]);
    } catch { setChatMessages((p) => [...p, { role: 'assistant', content: 'I apologize, but I encountered an error. Please try again.' }]); }
    finally { setChatLoading(false); }
  };

  // Clear chat memory
  const clearChatMemory = () => {
    const chatKey = `chatMemory_${userData?.email || userData?.id}`;
    localStorage.removeItem(chatKey);
    setChatMessages([{ role: 'assistant', content: `Chat history cleared! 🙏 Hello ${userData?.firstname || 'friend'}, how can I help you today?\n\n⚠️ Disclaimer: While I can provide biblical guidance and encouragement, it is important that you also maintain your personal communication with God through prayer and His Word to receive true wisdom. I am just your AI Assistant — the Holy Spirit is your ultimate Counselor and Guide.` }]);
    showToast('Chat history cleared', 'success');
  };

  // ============================================
  // PROFILE HANDLERS (from original)
  // ============================================
  // Password strength calculator
  const getPasswordStrength = (password) => {
    if (!password) return { score: 0, label: '', color: '' };
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    if (score <= 1) return { score: 1, label: 'Weak', color: '#dc3545' };
    if (score <= 2) return { score: 2, label: 'Fair', color: '#fd7e14' };
    if (score <= 3) return { score: 3, label: 'Good', color: '#ffc107' };
    if (score <= 4) return { score: 4, label: 'Strong', color: '#28a745' };
    return { score: 5, label: 'Very Strong', color: '#155724' };
  };

  // Image crop helper - creates cropped image from canvas
  const getCroppedImg = async (imageSrc, pixelCrop) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = imageSrc; });
    const canvas = document.createElement('canvas');
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, pixelCrop.width, pixelCrop.height);
    return new Promise((resolve) => { canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92); });
  };

  // Smooth close crop modal with animation
  const closeCropModal = () => {
    setClosingCropModal(true);
    setTimeout(() => { setShowCropModal(false); setCropImage(null); setClosingCropModal(false); }, 250);
  };

  // Close avatar menu when clicking outside
  useEffect(() => {
    if (!showAvatarMenu) return;
    const handleClickOutside = (e) => {
      if (avatarMenuRef.current && avatarMenuRef.current.contains(e.target)) return;
      if (avatarWrapperRef.current && avatarWrapperRef.current.contains(e.target)) return;
      setShowAvatarMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAvatarMenu]);

  // Close user action dropdown when clicking outside
  useEffect(() => {
    if (!userActionMenu) return;
    const handleClickOutsideMenu = (e) => {
      if (!e.target.closest('.um-dots-btn') && !e.target.closest('.um-dropdown')) {
        setUserActionMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutsideMenu);
    return () => document.removeEventListener('mousedown', handleClickOutsideMenu);
  }, [userActionMenu]);

  // Handle profile picture file selection
  const handleProfilePicSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) { showToast('Only JPEG, PNG, WebP, and GIF images are allowed', 'warning'); return; }
    const reader = new FileReader();
    reader.onload = () => { setCropImage(reader.result); setShowCropModal(true); setCrop({ x: 0, y: 0 }); setZoom(1); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Handle cropped image upload
  const handleCropComplete = async () => {
    if (!croppedAreaPixels || !cropImage) return;
    setUploadingPic(true);
    try {
      let blob = await getCroppedImg(cropImage, croppedAreaPixels);
      // Compress if larger than 2MB
      if (blob.size > 2 * 1024 * 1024) {
        const imageCompression = (await import('browser-image-compression')).default;
        const file = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
        blob = await imageCompression(file, { maxSizeMB: 2, maxWidthOrHeight: 1024, useWebWorker: true });
      }
      const formData = new FormData();
      formData.append('file', blob, 'avatar.jpg');
      formData.append('email', userData.email);
      const res = await fetch('/api/profile/upload-picture', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        const updated = { ...userData, profile_picture: data.url + '?t=' + Date.now() };
        setUserData(updated); sessionStorage.setItem('userData', JSON.stringify(updated)); localStorage.setItem('userData', JSON.stringify(updated));
        showToast('Profile picture updated!', 'success');
        closeCropModal();
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error uploading: ' + e.message, 'danger'); }
    finally { setUploadingPic(false); }
  };

  const saveProfile = async () => {
    setProfileLoading(true);
    try {
      const res = await fetch('/api/profile/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userData.email, firstname: profileForm.firstname, lastname: profileForm.lastname, birthdate: profileForm.birthdate, life_verse: profileForm.life_verse }) });
      const data = await res.json();
      if (data.success) { const updated = { ...userData, firstname: profileForm.firstname, lastname: profileForm.lastname, birthdate: profileForm.birthdate, life_verse: profileForm.life_verse }; setUserData(updated); sessionStorage.setItem('userData', JSON.stringify(updated)); localStorage.setItem('userData', JSON.stringify(updated)); showToast('Profile updated!', 'success'); fetchLifeVerse(profileForm.life_verse, lifeVerseVersion); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setProfileLoading(false); }
  };

  const changePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { showToast('Passwords do not match', 'warning'); return; }
    if (passwordForm.newPassword.length < 8) { showToast('Password must be at least 8 characters', 'warning'); return; }
    setProfileLoading(true);
    try {
      const verifyRes = await fetch('/api/profile/verify-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userData.email, currentPassword: passwordForm.currentPassword }) });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) { showToast('Current password is incorrect', 'danger'); setProfileLoading(false); return; }

      const res = await fetch('/api/profile/update-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userData.email, newPassword: passwordForm.newPassword }) });
      const data = await res.json();
      if (data.success) { showToast('Password updated!', 'success'); setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); }
      else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setProfileLoading(false); }
  };

  const handleSetPassword = async () => {
    if (setPasswordFormData.newPassword !== setPasswordFormData.confirmPassword) { showToast('Passwords do not match', 'warning'); return; }
    if (setPasswordFormData.newPassword.length < 8) { showToast('Password must be at least 8 characters', 'warning'); return; }
    setProfileLoading(true);
    try {
      const res = await fetch('/api/profile/set-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: userData.email, newPassword: setPasswordFormData.newPassword }) });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        setSetPasswordFormData({ newPassword: '', confirmPassword: '' });
        setHasLocalPassword(true);
        const updated = { ...userData, hasPassword: true };
        setUserData(updated);
        sessionStorage.setItem('userData', JSON.stringify(updated));
        localStorage.setItem('userData', JSON.stringify(updated));
      } else showToast(data.message, 'danger');
    } catch (e) { showToast('Error: ' + e.message, 'danger'); } finally { setProfileLoading(false); }
  };

  // Fetch full life verse text from AI
  const fetchLifeVerse = useCallback(async (verseInput, version) => {
    if (!verseInput) { setLifeVerseFullText(''); setLifeVerseRef(''); return; }
    const ver = version || lifeVerseVersion;
    const versionLabel = BIBLE_VERSIONS.find(bv => bv.value === ver)?.fullName || ver;
    // Check if input already contains verse text (e.g. "Jeremiah 29:11 - For I know...")
    const dashIndex = verseInput.indexOf(' - ');
    if (dashIndex > -1) {
      setLifeVerseRef(verseInput.substring(0, dashIndex).trim());
      setLifeVerseFullText(verseInput.substring(dashIndex + 3).trim());
      return;
    }
    // Check if it's just a reference like "Ephesians 6:1" or "Psalm 23:1-3"
    const refMatch = verseInput.trim().match(/^(\d?\s?[A-Za-z\s]+?)\s+(\d+)(?::(\d+(?:-\d+)?))?$/i);
    if (!refMatch) {
      // It's freeform text, display as-is
      setLifeVerseFullText(verseInput);
      setLifeVerseRef('');
      return;
    }
    setLifeVerseRef(verseInput.trim());
    setLifeVerseLoading(true);
    // Check cache
    const cacheKey = `lifeVerse_${verseInput.trim()}_${ver}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { setLifeVerseFullText(cached); setLifeVerseLoading(false); return; }
    try {
      const res = await fetch(GROQ_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'meta-llama/llama-4-scout-17b-16e-instruct', messages: [{ role: 'system', content: `You are a Bible text provider. Provide ONLY the verse text, nothing else. No verse numbers, no book name, no quotes. Just the pure verse text in the ${versionLabel} translation. If Cebuano, use Ang Pulong Sa Dios. If Tagalog, use Ang Salita ng Dios.` }, { role: 'user', content: `Provide the text of ${verseInput.trim()} in ${versionLabel}.` }], temperature: 0.1, max_tokens: 300 }),
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim().replace(/^"|"$/g, '').replace(/^\u201c|\u201d$/g, '');
      if (text) { setLifeVerseFullText(text); localStorage.setItem(cacheKey, text); }
    } catch { /* silent */ }
    finally { setLifeVerseLoading(false); }
  }, [lifeVerseVersion]);

  // ============================================
  // LOGOUT
  // ============================================
  const confirmLogout = () => { sessionStorage.removeItem('userData'); localStorage.removeItem('userData'); router.replace('/login'); };

  // ============================================
  // HELPERS
  // ============================================
  const generateCalendar = () => {
    const year = calendarDate.getFullYear(); const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks = []; let days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) { days.push(d); if (days.length === 7) { weeks.push(days); days = []; } }
    if (days.length > 0) { while (days.length < 7) days.push(null); weeks.push(days); }
    return weeks;
  };

  const hasSchedule = (day) => {
    if (!day) return false;
    const dateStr = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return scheduleData.some((s) => s.scheduleDate === dateStr);
  };

  const getScheduleForDate = (dateStr) => scheduleData.find((s) => s.scheduleDate === dateStr);
  const formatDate = (dateStr) => { if (!dateStr) return ''; return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); };
  const formatDateTime = (dateStr) => { if (!dateStr) return ''; return new Date(dateStr).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const extractYouTubeId = (url) => { if (!url) return null; const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/); return m ? m[1] : null; };

  const getTodaysBirthdays = () => {
    const today = new Date(); const m = today.getMonth() + 1; const d = today.getDate();
    return birthdayData.filter((b) => { if (!b.birthdate) return false; const bd = new Date(b.birthdate); return bd.getMonth() + 1 === m && bd.getDate() === d; });
  };

  const getUpcomingBirthdays = (days = 30) => {
    const today = new Date(); const end = new Date(today.getTime() + days * 86400000);
    return birthdayData.filter((b) => { if (!b.birthdate) return false; const bd = new Date(b.birthdate); bd.setFullYear(today.getFullYear()); return bd > today && bd <= end; }).sort((a, b) => { const ad = new Date(a.birthdate); ad.setFullYear(today.getFullYear()); const bd2 = new Date(b.birthdate); bd2.setFullYear(today.getFullYear()); return ad - bd2; });
  };

  const todaysBirthdays = getTodaysBirthdays();
  const upcomingBirthdays = getUpcomingBirthdays(30);

  // ============================================
  // RENDER GUARD
  // ============================================
  if (!userData || !permissionsLoaded) {
    return (
      <div className="dashboard-loading-screen">
        <div className="dashboard-loading-logo">
          <img src="/assets/LOGO.png" alt="JSCI" />
        </div>
        <div className="dashboard-loading-spinner"></div>
        <p className="dashboard-loading-text">Preparing your dashboard...</p>
      </div>
    );
  }

  const initials = `${userData.firstname?.[0] || ''}${userData.lastname?.[0] || ''}`.toUpperCase();
  const dashboardType = getDashboardType(userRole);
  const rawSidebarMenu = getSidebarMenu(userRole, userData);
  // Filter sidebar items based on SuperAdmin permission overrides
  // Checks BOTH sidebar-level toggles (sidebar.*) AND action-level toggles (events.view, bible.spiritual_assistant, etc.)
  const sidebarMenu = rawSidebarMenu.filter((item) => {
    return isSidebarItemEnabled(userRole, item.section, permissionOverrides);
  });
  const canManage = (module) => hasPermission(userRole, module);

  // ============================================
  // RENDER
  // ============================================
  return (
    <div className="dashboard-wrapper">
      {/* Toast */}
      {toastMessage && <div className={`toast-notification toast-${toastMessage.type}`}>{toastMessage.message}</div>}

      {/* Account Deleted Overlay */}
      {accountDeleted && (
        <div className="account-deleted-overlay">
          <div className="account-deleted-particles">
            {[...Array(20)].map((_, i) => (
              <div key={i} className="account-deleted-particle" style={{ left: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 6}s`, animationDuration: `${6 + Math.random() * 4}s` }} />
            ))}
          </div>
          <div className="account-deleted-content">
            <div className="account-deleted-logo-wrap">
              <div className="account-deleted-logo-glow"></div>
              <img src="/assets/LOGO.png" alt="JSCI" className="account-deleted-logo" />
            </div>
            <div className="account-deleted-icon">
              <svg viewBox="0 0 64 64" className="account-deleted-heart-svg">
                <path className="account-deleted-heart-path" d="M32 56S8 40 8 22a12 12 0 0 1 24-2 12 12 0 0 1 24 2c0 18-24 34-24 34z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h1 className="account-deleted-title">Account Not Found</h1>
            <p className="account-deleted-message">
              It seems your account is no longer active. But remember, God&apos;s love for you never changes.
              You are always welcome in His arms.
            </p>
            <div className="account-deleted-verse-card">
              <div className="account-deleted-verse-glow"></div>
              <span className="account-deleted-quote-icon">✦</span>
              <p className="account-deleted-verse-text">
                &ldquo;For I am convinced that neither death nor life, neither angels nor demons,
                neither the present nor the future, nor any powers, neither height nor depth,
                nor anything else in all creation, will be able to separate us from the love of
                God that is in Christ Jesus our Lord.&rdquo;
              </p>
              <p className="account-deleted-verse-ref">— Romans 8:38-39</p>
            </div>
            <p className="account-deleted-subtext">
              If you believe this is a mistake, please contact the church administration.
            </p>
            <button className="account-deleted-btn" onClick={() => { router.replace('/login'); }}>
              <i className="fas fa-home"></i> Return Home
            </button>
          </div>
        </div>
      )}

      {/* Welcome Modal */}
      {showWelcomeModal && (
        <div className="welcome-modal-overlay" onClick={() => {
          const welcomeKey = `welcomed_${userData?.email || userData?.id}`;
          localStorage.setItem(welcomeKey, 'true');
          setShowWelcomeModal(false);
        }}>
          <div className="welcome-modal" onClick={(e) => e.stopPropagation()}>
            {/* Animated background orbs */}
            <div className="wm-orb wm-orb-1"></div>
            <div className="wm-orb wm-orb-2"></div>
            <div className="wm-orb wm-orb-3"></div>

            {/* Floating sparkles */}
            <div className="wm-sparkles">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="wm-sparkle" style={{
                  left: `${15 + Math.random() * 70}%`,
                  top: `${10 + Math.random() * 80}%`,
                  animationDelay: `${i * 0.5}s`,
                }} />
              ))}
            </div>

            {/* Logo */}
            <div className="wm-logo-wrap">
              <div className="wm-logo-ring"></div>
              <img src="/assets/LOGO.png" alt="JSCI" className="wm-logo" />
            </div>

            {/* Greeting */}
            <div className="wm-greeting">
              <span className="wm-wave">👋</span>
              <h2>Welcome, <span className="wm-name">{userData?.firstname || 'Beloved'}</span></h2>
              <p className="wm-subtitle">We&apos;re so glad you&apos;re here</p>
            </div>

            {/* Divider */}
            <div className="wm-divider">
              <span className="wm-divider-dot"></span>
              <span className="wm-divider-line"></span>
              <span className="wm-divider-dot"></span>
            </div>

            {/* Verse */}
            <div className="wm-verse-card">
              <i className="fas fa-quote-left wm-quote-icon"></i>
              <p className="wm-verse-text">{welcomeVerse.verse}</p>
              <span className="wm-verse-ref">{welcomeVerse.reference}</span>
            </div>

            {/* CTA */}
            <button className="wm-btn" onClick={() => {
              const welcomeKey = `welcomed_${userData?.email || userData?.id}`;
              localStorage.setItem(welcomeKey, 'true');
              setShowWelcomeModal(false);
            }}>
              <span>Get Started</span>
              <i className="fas fa-arrow-right"></i>
            </button>

            {/* Footer tagline */}
            <p className="wm-footer">Joyful Sound Church International</p>
          </div>
        </div>
      )}

      {/* Logout Modal */}
      {showLogoutModal && (
        <div className="logout-modal" style={{ display: 'flex' }}>
          <div className="logout-modal-content">
            <div className="logout-modal-header">
              <div className="logout-modal-icon"><i className="fas fa-sign-out-alt"></i></div>
              <h3>Confirm Logout</h3><p>Ministry Portal</p>
            </div>
            <div className="logout-modal-body">
              <p>Are you sure you want to logout from your account?</p>
              <div className="logout-modal-actions">
                <button className="logout-modal-btn logout-modal-cancel" onClick={() => setShowLogoutModal(false)}><i className="fas fa-times"></i> Cancel</button>
                <button className="logout-modal-btn logout-modal-confirm" onClick={confirmLogout}><i className="fas fa-sign-out-alt"></i> Logout</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Detail Modal */}
      {selectedSchedule && (
        <div className="schedule-modal" style={{ display: 'flex' }} onClick={() => setSelectedSchedule(null)}>
          <div className="schedule-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="schedule-modal-header">
              <h3><i className="fas fa-calendar-alt"></i> Schedule Details</h3>
              <button className="modal-close-btn" onClick={() => setSelectedSchedule(null)}><i className="fas fa-times"></i></button>
            </div>
            <div className="schedule-modal-body">
              <p><strong>Date:</strong> {formatDate(selectedSchedule.scheduleDate)}</p>
              <p><strong>{selectedSchedule.hasSubstitute ? 'Song Leader (Substitute):' : 'Song Leader:'}</strong> {selectedSchedule.songLeader}</p>
              {selectedSchedule.hasSubstitute && selectedSchedule.originalSongLeader && (
                <p><strong>Song Leader:</strong> <span className="paw-grayed-out">{selectedSchedule.originalSongLeader}</span></p>
              )}
              {selectedSchedule.backupSingers?.length > 0 && <p><strong>Backup:</strong> {selectedSchedule.backupSingers.join(', ')}</p>}
              {selectedSchedule.practiceDate && <p><strong>Practice:</strong> {formatDate(selectedSchedule.practiceDate)}</p>}
              {selectedSchedule.slowSongs?.length > 0 && (
                <div className="song-section"><h4><i className="fas fa-music"></i> Slow Songs</h4>
                  {selectedSchedule.slowSongs.map((song, i) => (
                    <div key={i} className="song-detail-card">
                      <p className="song-title">{song.title}</p>
                      {song.link && extractYouTubeId(song.link) && <div className="youtube-embed"><iframe src={`https://www.youtube.com/embed/${extractYouTubeId(song.link)}`} allowFullScreen title={song.title}></iframe></div>}
                      {song.lyrics && <pre className="song-lyrics">{song.lyrics}</pre>}
                      {song.instructions && <p className="song-instructions"><strong>Instructions:</strong> {song.instructions}</p>}
                    </div>
                  ))}
                </div>
              )}
              {selectedSchedule.fastSongs?.length > 0 && (
                <div className="song-section"><h4><i className="fas fa-bolt"></i> Fast Songs</h4>
                  {selectedSchedule.fastSongs.map((song, i) => (
                    <div key={i} className="song-detail-card">
                      <p className="song-title">{song.title}</p>
                      {song.link && extractYouTubeId(song.link) && <div className="youtube-embed"><iframe src={`https://www.youtube.com/embed/${extractYouTubeId(song.link)}`} allowFullScreen title={song.title}></iframe></div>}
                      {song.lyrics && <pre className="song-lyrics">{song.lyrics}</pre>}
                      {song.instructions && <p className="song-instructions"><strong>Instructions:</strong> {song.instructions}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Top Navbar */}
      <header className="mobile-topbar">
        <div className="mobile-topbar-left">
          <img src="/assets/LOGO.png" alt="JSCI Logo" className="mobile-topbar-logo" />
        </div>
        <button className="mobile-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu">
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`}></span>
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`}></span>
          <span className={`hamburger-line ${sidebarOpen ? 'open' : ''}`}></span>
        </button>
      </header>
      <div className={`overlay ${sidebarOpen ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}></div>

      <div className="dashboard-container">
        {/* ============ SIDEBAR ============ */}
        <aside className={`sidebar ${sidebarOpen ? 'active' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
          {/* Top: Logo + Brand (vertical) */}
          <div className="sidebar-top">
            <div className="sidebar-brand">
              <div className="logo">
                <img src="/assets/LOGO.png" alt="JSCI Logo" />
              </div>
              <div className="brand-text">
                <span className="brand-name">JOYFUL SOUND CHURCH</span>
                <span className="brand-sub">INTERNATIONAL</span>
              </div>
            </div>
          </div>

          {/* Menu */}
          <nav className="sidebar-menu">
            <div className="menu-section-label">Menu</div>
            {sidebarMenu.map((item) => {
              const isGuestRole = userRole === 'Guest';
              const isLocked = !isVerified && !isGuestRole && item.section !== 'home';
              return (
                <a key={item.id}
                  className={`menu-item ${activeSection === item.section ? 'active' : ''} ${isLocked ? 'disabled' : ''}`}
                  onClick={() => showSection(item.section)}
                  title={sidebarCollapsed ? item.label : (isLocked ? '🔒 Account verification needed' : '')}
                  onMouseEnter={(e) => {
                    if (isLocked) {
                      const tip = e.currentTarget.querySelector('.sidebar-lock-tooltip');
                      if (tip) tip.style.opacity = '1';
                    }
                  }}
                  onMouseLeave={(e) => {
                    const tip = e.currentTarget.querySelector('.sidebar-lock-tooltip');
                    if (tip) tip.style.opacity = '0';
                  }}
                >
                  <span className="menu-icon"><i className={item.icon}></i></span>
                  <span className="menu-label">{item.label}</span>
                  {item.section === 'messages' && unreadCount > 0 && (
                    <span className="notification-badge">{unreadCount}</span>
                  )}
                  {isLocked && (
                    <>
                      <span className="menu-lock"><i className="fas fa-lock"></i></span>
                      <div className="sidebar-lock-tooltip">🔒 Account verification needed</div>
                    </>
                  )}
                </a>
              );
            })}
          </nav>

          {/* Bottom: Collapse toggle + User card + Logout + Theme */}
          <div className="sidebar-bottom">
            <button className="collapse-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title={sidebarCollapsed ? 'Expand' : 'Collapse'}>
              <i className={`fas fa-chevron-${sidebarCollapsed ? 'right' : 'left'}`}></i>
              <span className="collapse-label">{sidebarCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
            <div className={`sidebar-user-card ${(!isVerified && userRole !== 'Guest') ? 'locked' : ''}`}
              onClick={() => {
                if (!isVerified && userRole !== 'Guest') {
                  showToast('🔒 Your account needs to be verified before you can access your profile', 'warning');
                  return;
                }
                showSection('my-profile');
              }}
              onMouseEnter={(e) => {
                if (!isVerified && userRole !== 'Guest') {
                  const tip = e.currentTarget.querySelector('.sidebar-lock-tooltip');
                  if (tip) tip.style.opacity = '1';
                }
              }}
              onMouseLeave={(e) => {
                const tip = e.currentTarget.querySelector('.sidebar-lock-tooltip');
                if (tip) tip.style.opacity = '0';
              }}
            >
              {(!isVerified && userRole !== 'Guest') && (
                <div className="sidebar-lock-tooltip">🔒 Account verification needed</div>
              )}
              <div className="sidebar-avatar">
                {userData.profile_picture ? (
                  <img src={userData.profile_picture} alt="Profile" referrerPolicy="no-referrer" />
                ) : (
                  <span className="avatar-initials">{initials}</span>
                )}
                <div className={`sidebar-status-dot ${isVerified ? 'verified' : 'unverified'}`}></div>
              </div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{userData.firstname} {userData.lastname}</div>
                <div className="sidebar-role-pill">{userRole}</div>
              </div>
            </div>

            <button className="logout-btn" onClick={() => setShowLogoutModal(true)}>
              <i className="fas fa-sign-out-alt"></i>
              <span className="logout-label">Logout</span>
            </button>

            <div className="sidebar-theme-toggle">
              <button className={`theme-btn ${!darkMode ? 'active' : ''}`} onClick={() => { if (darkMode) toggleDarkMode(); }}>
                <i className="fas fa-sun"></i> <span className="theme-label">Light</span>
              </button>
              <button className={`theme-btn ${darkMode ? 'active' : ''}`} onClick={() => { if (!darkMode) toggleDarkMode(); }}>
                <i className="fas fa-moon"></i> <span className="theme-label">Dark</span>
              </button>
            </div>
          </div>
        </aside>

        {/* ============ MAIN CONTENT ============ */}
        <main className="main-content">

          {/* ========== HOME SECTION ========== */}
          <section className={`content-section ${activeSection === 'home' ? 'active' : ''}`}>
            <h2 className="section-title">Home</h2>
            {isVerified ? (
              <>
                <div className="welcome-card">
                  <div className="welcome-card-glow"></div>
                  <div className="welcome-card-abstract">
                    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="120" cy="80" r="60" fill="rgba(255,195,0,0.06)" />
                      <circle cx="160" cy="120" r="45" fill="rgba(255,195,0,0.04)" />
                      <circle cx="80" cy="140" r="30" fill="rgba(255,255,255,0.03)" />
                      <path d="M10,180 Q60,100 120,160 T200,100" stroke="rgba(255,195,0,0.12)" strokeWidth="1.5" fill="none" />
                      <path d="M0,140 Q80,60 160,130 T240,80" stroke="rgba(255,255,255,0.06)" strokeWidth="1" fill="none" />
                      <path d="M30,200 Q100,120 180,180" stroke="rgba(255,195,0,0.08)" strokeWidth="1" fill="none" />
                    </svg>
                  </div>
                  <div className="welcome-card-content">
                    <div className="welcome-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                    <h2 className="welcome-greeting">{(() => {
                      const greetings = [
                        `Welcome home, ${userData.firstname}. We're so glad you're here.`,
                        `It's a joy to see you, ${userData.firstname}.`,
                        `You are a blessing to this ministry, ${userData.firstname}.`,
                        `We're better because you're here, ${userData.firstname}.`,
                        `You belong here, ${userData.firstname}.`,
                        `Grace and peace to you, ${userData.firstname}.`,
                        `May God refresh your heart today, ${userData.firstname}.`,
                        `The Lord has something beautiful for you today, ${userData.firstname}.`,
                        `Walk boldly in faith today, ${userData.firstname}.`,
                        `Your service matters, ${userData.firstname}. Heaven sees it.`,
                        `Welcome, ${userData.firstname}. Thank you for serving faithfully.`,
                        `Your dedication blesses many, ${userData.firstname}.`,
                        `Lead with love today, ${userData.firstname}.`,
                        `Your impact in this ministry is powerful, ${userData.firstname}.`,
                        `Let's serve with excellence today, ${userData.firstname}.`,
                        `Welcome, ${userData.firstname}. Let's grow together.`,
                        `Good to see you, ${userData.firstname}.`,
                        `Shine for His glory today, ${userData.firstname}.`,
                        `Ready for today's mission, ${userData.firstname}?`,
                        `Glad you're here, ${userData.firstname}.`,
                      ];
                      const dayIndex = new Date().getDate() % greetings.length;
                      return greetings[dayIndex];
                    })()}</h2>
                  </div>
                </div>

                {/* Dashboard Stats */}
                {(dashboardType === 'admin' || dashboardType === 'super-admin' || dashboardType === 'pastor') && (
                  <div className="stats-container">
                    <div className="stat-card" onClick={() => showSection('user-management')}><div className="stat-icon"><i className="fas fa-users"></i></div><div className="stat-value">{adminUsers.length || '—'}</div><div className="stat-label">Total Users</div></div>
                    <div className="stat-card" onClick={() => showSection('events-management')}><div className="stat-icon"><i className="fas fa-calendar-alt"></i></div><div className="stat-value">{events.length || '—'}</div><div className="stat-label">Events</div></div>
                    <div className="stat-card" onClick={() => showSection('announcements-management')}><div className="stat-icon"><i className="fas fa-bullhorn"></i></div><div className="stat-value">{announcements.length || '—'}</div><div className="stat-label">Announcements</div></div>
                    <div className="stat-card"><div className="stat-icon"><i className="fas fa-church"></i></div><div className="stat-value">{ministriesList.length || '4'}</div><div className="stat-label">Ministries</div></div>
                  </div>
                )}

                {/* Bible Verse */}
                <div className="bible-verse-container">
                  <div className="verse-of-the-day">&ldquo;{dailyVerse.verse}&rdquo;</div>
                  <div className="verse-reference">— {dailyVerse.reference}</div>
                  {dailyVerse.explanation && <div className="verse-explanation">{dailyVerse.explanation}</div>}
                </div>

                {/* Pastors & Church Family Gatherings */}
                {(dashboardType !== 'super-admin') && (
                  <>
                    <div className="pastors-section">
                      <div className="pastors-big-title">OUR PASTORS</div>
                      <div className="pastors-carousel">
                        <div className="pastors-backdrop">
                          <svg viewBox="0 0 900 480" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                            <defs>
                              {/* Golden flare gradient */}
                              <radialGradient id="pgFlare1" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="rgba(255,195,0,0.28)" />
                                <stop offset="40%" stopColor="rgba(201,152,11,0.12)" />
                                <stop offset="100%" stopColor="rgba(146,108,21,0)" />
                              </radialGradient>
                              <radialGradient id="pgFlare2" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="rgba(255,195,0,0.22)" />
                                <stop offset="50%" stopColor="rgba(201,152,11,0.08)" />
                                <stop offset="100%" stopColor="rgba(146,108,21,0)" />
                              </radialGradient>
                              <radialGradient id="pgFlare3" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="rgba(255,215,80,0.18)" />
                                <stop offset="100%" stopColor="rgba(255,195,0,0)" />
                              </radialGradient>
                              {/* Sweep line gradients */}
                              <linearGradient id="pgSweep1" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="rgba(146,108,21,0)" />
                                <stop offset="30%" stopColor="rgba(201,152,11,0.25)" />
                                <stop offset="70%" stopColor="rgba(201,152,11,0.25)" />
                                <stop offset="100%" stopColor="rgba(146,108,21,0)" />
                              </linearGradient>
                              <linearGradient id="pgSweep2" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="rgba(146,108,21,0)" />
                                <stop offset="50%" stopColor="rgba(255,195,0,0.15)" />
                                <stop offset="100%" stopColor="rgba(146,108,21,0)" />
                              </linearGradient>
                              {/* Star sparkle */}
                              <filter id="pgGlow">
                                <feGaussianBlur stdDeviation="2" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                              </filter>
                            </defs>

                            {/* === Large ambient golden flares === */}
                            <ellipse cx="450" cy="240" rx="350" ry="200" fill="url(#pgFlare1)" />
                            <ellipse cx="200" cy="200" rx="220" ry="160" fill="url(#pgFlare2)" />
                            <ellipse cx="720" cy="220" rx="220" ry="160" fill="url(#pgFlare2)" />
                            {/* Smaller accent flares */}
                            <ellipse cx="100" cy="120" rx="100" ry="80" fill="url(#pgFlare3)" />
                            <ellipse cx="800" cy="100" rx="110" ry="80" fill="url(#pgFlare3)" />
                            <ellipse cx="450" cy="400" rx="250" ry="80" fill="url(#pgFlare3)" />

                            {/* === Sweeping elegant arcs === */}
                            <path d="M0,380 Q250,80 450,200 Q650,320 900,80" stroke="url(#pgSweep1)" strokeWidth="1.5" fill="none" />
                            <path d="M0,320 Q300,120 500,240 Q700,360 900,160" stroke="rgba(201,152,11,0.15)" strokeWidth="1" fill="none" />
                            <path d="M50,400 Q450,20 850,400" stroke="url(#pgSweep2)" strokeWidth="1.2" fill="none" />
                            <path d="M100,420 Q450,80 800,420" stroke="rgba(146,108,21,0.1)" strokeWidth="0.8" fill="none" />

                            {/* === Decorative golden circles === */}
                            <circle cx="120" cy="160" r="90" stroke="rgba(201,152,11,0.12)" strokeWidth="1" fill="none" />
                            <circle cx="120" cy="160" r="60" stroke="rgba(201,152,11,0.08)" strokeWidth="0.6" fill="none" />
                            <circle cx="780" cy="180" r="100" stroke="rgba(201,152,11,0.12)" strokeWidth="1" fill="none" />
                            <circle cx="780" cy="180" r="65" stroke="rgba(201,152,11,0.08)" strokeWidth="0.6" fill="none" />
                            <circle cx="450" cy="240" r="220" stroke="rgba(146,108,21,0.06)" strokeWidth="0.8" fill="none" />
                            <circle cx="450" cy="240" r="280" stroke="rgba(146,108,21,0.04)" strokeWidth="0.5" fill="none" />

                            {/* === Bokeh dots === */}
                            <circle cx="80" cy="100" r="6" fill="rgba(255,195,0,0.18)" />
                            <circle cx="160" cy="60" r="4" fill="rgba(255,195,0,0.14)" />
                            <circle cx="60" cy="300" r="5" fill="rgba(201,152,11,0.16)" />
                            <circle cx="840" cy="90" r="5" fill="rgba(255,195,0,0.18)" />
                            <circle cx="800" cy="340" r="6" fill="rgba(201,152,11,0.16)" />
                            <circle cx="870" cy="260" r="4" fill="rgba(255,195,0,0.12)" />
                            <circle cx="300" cy="50" r="3.5" fill="rgba(255,195,0,0.14)" />
                            <circle cx="600" cy="40" r="3" fill="rgba(255,195,0,0.12)" />
                            <circle cx="350" cy="420" r="4" fill="rgba(201,152,11,0.14)" />
                            <circle cx="550" cy="430" r="3.5" fill="rgba(201,152,11,0.12)" />

                            {/* === Diamond sparkles with glow === */}
                            <g filter="url(#pgGlow)">
                              <path d="M130,90 L138,102 L130,114 L122,102 Z" fill="rgba(255,195,0,0.25)" />
                              <path d="M770,80 L778,92 L770,104 L762,92 Z" fill="rgba(255,195,0,0.25)" />
                              <path d="M50,250 L56,260 L50,270 L44,260 Z" fill="rgba(201,152,11,0.2)" />
                              <path d="M850,280 L856,290 L850,300 L844,290 Z" fill="rgba(201,152,11,0.2)" />
                            </g>

                            {/* === Cross sparkle accents (4-pointed stars) === */}
                            <g filter="url(#pgGlow)">
                              <path d="M90,200 L93,190 L96,200 L93,210 Z" fill="rgba(255,215,80,0.3)" />
                              <path d="M88,197 L93,194 L98,197 L93,200 Z" fill="rgba(255,215,80,0.3)" />
                            </g>
                            <g filter="url(#pgGlow)">
                              <path d="M810,160 L813,150 L816,160 L813,170 Z" fill="rgba(255,215,80,0.3)" />
                              <path d="M808,157 L813,154 L818,157 L813,160 Z" fill="rgba(255,215,80,0.3)" />
                            </g>
                            <g filter="url(#pgGlow)">
                              <path d="M450,60 L453,48 L456,60 L453,72 Z" fill="rgba(255,215,80,0.2)" />
                              <path d="M447,57 L453,54 L459,57 L453,60 Z" fill="rgba(255,215,80,0.2)" />
                            </g>

                            {/* === Horizontal ornamental lines === */}
                            <line x1="60" y1="240" x2="360" y2="240" stroke="url(#pgSweep2)" strokeWidth="0.8" />
                            <line x1="540" y1="240" x2="840" y2="240" stroke="url(#pgSweep2)" strokeWidth="0.8" />
                          </svg>
                        </div>
                        <div className="pastors-carousel-track">
                          {PASTORS.map((p, i) => {
                            const offset = (i - pastorCarouselIndex + PASTORS.length) % PASTORS.length;
                            const isCenter = offset === 0;
                            const isLeft1 = offset === PASTORS.length - 1;
                            const isRight1 = offset === 1;
                            const isLeft2 = offset === PASTORS.length - 2;
                            const isRight2 = offset === 2;
                            let posClass = 'pastors-card-hidden';
                            if (isCenter) posClass = 'pastors-card-center';
                            else if (isLeft1) posClass = 'pastors-card-left-1';
                            else if (isRight1) posClass = 'pastors-card-right-1';
                            else if (isLeft2) posClass = 'pastors-card-left-2';
                            else if (isRight2) posClass = 'pastors-card-right-2';
                            return (
                              <div key={i} className={`pastors-carousel-card ${posClass}`} onClick={() => setPastorCarouselIndex(i)}>
                                <div className="pastors-carousel-img" style={{ backgroundImage: `url('${p.photo}')` }}></div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="pastors-carousel-dots">
                        {PASTORS.map((_, i) => (<span key={i} className={`pastors-dot ${i === pastorCarouselIndex ? 'active' : ''}`} onClick={() => setPastorCarouselIndex(i)}></span>))}
                      </div>
                      <div className="pastors-carousel-info">
                        <div className="pastors-carousel-name">
                          <span className="pastors-name-line"></span>
                          <span>{PASTORS[pastorCarouselIndex].name}</span>
                          <span className="pastors-name-line"></span>
                        </div>
                        <div className="pastors-carousel-role">
                          <span className="pastors-role-arrow">&#9664;</span>
                          <span>{PASTORS[pastorCarouselIndex].title}</span>
                          <span className="pastors-role-arrow">&#9654;</span>
                        </div>
                      </div>
                    </div>
                    <div className="church-family-section">
                      <h2>Our Church Family Gatherings</h2>
                      <p style={{ color: '#6c757d', marginBottom: 20 }}>Celebrating fellowship and community</p>
                      <div className="family-gathering-grid">
                        {GATHERINGS.map((g, i) => (<div key={i} className="gathering-card"><div className="gathering-photo" style={{ backgroundImage: `url('${g.photo}')`, backgroundColor: '#e9ecef' }}></div><div className="gathering-info"><div className="gathering-title">{g.title}</div><div className="gathering-description">{g.desc}</div></div></div>))}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="pending-home">
                {/* Welcome Hero */}
                <div className="pending-hero">
                  <div className="pending-hero-particles">
                    {[...Array(12)].map((_, i) => <div key={i} className="pending-hero-particle" style={{ left: `${8 + Math.random() * 84}%`, animationDelay: `${Math.random() * 5}s`, animationDuration: `${5 + Math.random() * 4}s` }} />)}
                  </div>
                  <div className="pending-hero-content">
                    <div className="pending-hero-icon">
                      <div className="pending-hero-icon-ring"></div>
                      <i className="fas fa-dove"></i>
                    </div>
                    <h2 className="pending-hero-title">Welcome, {userData.firstname}!</h2>
                    <p className="pending-hero-subtitle">Your account is being reviewed by our church administration</p>
                    <div className="pending-status-pills">
                      <div className="pending-pill pending-pill-status">
                        <i className="fas fa-hourglass-half"></i>
                        <span>Pending Verification</span>
                      </div>
                      <div className="pending-pill pending-pill-time">
                        <i className="fas fa-clock"></i>
                        <span>Usually 24-48 hours</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI Encouragement Verse */}
                <div className="pending-verse-section">
                  <div className="pending-section-header">
                    <h3><i className="fas fa-hands-praying"></i> A Word of Encouragement</h3>
                    <button className="pending-refresh-btn" onClick={cyclePendingVerse} title="Next verse">
                      <i className="fas fa-sync-alt"></i>
                    </button>
                  </div>
                  {pendingAiVerse ? (
                    <div className="pending-verse-card">
                      <div className="pending-verse-glow"></div>
                      <div className="pending-verse-quote-icon">✦</div>
                      <p className="pending-verse-text">&ldquo;{pendingAiVerse.verse}&rdquo;</p>
                      <p className="pending-verse-ref">— {pendingAiVerse.reference}</p>
                      {pendingAiVerse.encouragement && (
                        <div className="pending-verse-encouragement">
                          <i className="fas fa-heart"></i>
                          <p>{pendingAiVerse.encouragement}</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Profile Setup (Birthdate & Life Verse) — hidden once completed */}
                {!pendingSetupDone && (
                <div className="pending-setup-section">
                  <div className="pending-section-header">
                    <h3><i className="fas fa-user-edit"></i> Set Up Your Profile</h3>
                  </div>
                  <p className="pending-setup-desc">Get a head start while you wait! Set your birthdate and pick a life verse that inspires you.</p>
                  <div className="pending-setup-grid">
                    <div className="pending-setup-field">
                      <label><i className="fas fa-birthday-cake"></i> Birthdate</label>
                      <input type="date" value={pendingBirthdate} onChange={(e) => setPendingBirthdate(e.target.value)} className="pending-input" />
                    </div>
                    <div className="pending-setup-field pending-setup-field-full">
                      <label><i className="fas fa-book-open"></i> Life Verse</label>
                      <input type="text" value={pendingLifeVerse} onChange={(e) => setPendingLifeVerse(e.target.value)} placeholder="e.g. Philippians 4:13 or type your own verse" className="pending-input" />
                      <span className="pending-input-hint">Enter a Bible reference like &quot;John 3:16&quot; or type your favorite verse</span>
                    </div>
                  </div>
                  <button className="pending-save-btn" onClick={savePendingSetup} disabled={pendingSetupSaving || (!pendingBirthdate && !pendingLifeVerse)}>
                    {pendingSetupSaving ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : <><i className="fas fa-save"></i> Save My Setup</>}
                  </button>

                  {/* AI Life Verse Feedback */}
                  {pendingLifeVerseFeedbackLoading && (
                    <div className="pending-feedback-loading">
                      <i className="fas fa-sparkles"></i> Reflecting on your verse...
                    </div>
                  )}
                  {pendingLifeVerseFeedback && !pendingLifeVerseFeedbackLoading && (
                    <div className="pending-feedback-card">
                      <div className="pending-feedback-icon">💛</div>
                      <p>{pendingLifeVerseFeedback}</p>
                    </div>
                  )}
                </div>
                )}

                {/* Fun Facts & Game Row */}
                <div className="pending-fun-row">
                  {/* Bible Fun Facts */}
                  <div className="pending-fun-facts">
                    <div className="pending-section-header">
                      <h3><i className="fas fa-lightbulb"></i> Bible Fun Fact</h3>
                      <button className="pending-refresh-btn" onClick={cyclePendingFact} title="Next fact">
                        <i className="fas fa-sync-alt"></i>
                      </button>
                    </div>
                    {pendingFunFact ? (
                      <div className="pending-fact-card">
                        <div className="pending-fact-emoji">{pendingFunFact.emoji || '📖'}</div>
                        <p className="pending-fact-text">{pendingFunFact.fact}</p>
                        <span className="pending-fact-category">{pendingFunFact.category}</span>
                      </div>
                    ) : null}
                  </div>

                  {/* Bible Trivia Game */}
                  <div className="pending-trivia-game">
                    <div className="pending-section-header">
                      <h3><i className="fas fa-gamepad"></i> Bible Trivia</h3>
                      {pendingGameScore.total > 0 && (
                        <span className="pending-game-score">{pendingGameScore.correct}/{pendingGameScore.total}</span>
                      )}
                    </div>
                    {pendingGameActive && pendingGameQuestion && (
                      <div className="pending-game-card">
                        <p className="pending-game-question">{pendingGameQuestion.question}</p>
                        <div className="pending-game-options">
                          {pendingGameQuestion.options.map((opt, i) => {
                            const isSelected = pendingGameResult?.selected === i;
                            const isCorrect = i === pendingGameQuestion.correct;
                            let optClass = 'pending-game-option';
                            if (pendingGameResult !== null) {
                              if (isCorrect) optClass += ' correct';
                              else if (isSelected && !pendingGameResult.isCorrect) optClass += ' wrong';
                            }
                            return (
                              <button key={i} className={optClass} onClick={() => submitPendingGameAnswer(i)} disabled={pendingGameResult !== null}>
                                <span className="pending-option-letter">{String.fromCharCode(65 + i)}</span>
                                <span>{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                        {pendingGameResult && (
                          <div className={`pending-game-explanation ${pendingGameResult.isCorrect ? 'correct' : 'wrong'}`}>
                            <div className="pending-game-result-icon">{pendingGameResult.isCorrect ? '🎉' : '💡'}</div>
                            <p><strong>{pendingGameResult.isCorrect ? 'Correct!' : 'Not quite!'}</strong> {pendingGameQuestion.explanation}</p>
                            <button className="pending-game-next-btn" onClick={nextPendingTrivia}>
                              <i className="fas fa-arrow-right"></i> Next Question
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Helpful Info */}
                <div className="pending-info-footer">
                  <div className="pending-info-card">
                    <i className="fas fa-info-circle"></i>
                    <div>
                      <strong>What happens next?</strong>
                      <p>A church administrator will review and verify your account. Once approved, you&apos;ll have full access to all ministry features, community hub, events, and more!</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ========== WEEKLY SCHEDULE ========== */}
          <section className={`content-section ${activeSection === 'weekly-schedule' ? 'active' : ''}`}>
            <h2 className="section-title">Weekly Schedule</h2>
            <div className="schedule-calendar">
              <div className="calendar-header">
                <button className="calendar-nav-btn" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}><i className="fas fa-chevron-left"></i></button>
                <h3>{calendarDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                <button className="calendar-nav-btn" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}><i className="fas fa-chevron-right"></i></button>
              </div>
              <table className="calendar-table"><thead><tr>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <th key={d}>{d}</th>)}</tr></thead>
                <tbody>{generateCalendar().map((week, wi) => (
                  <tr key={wi}>{week.map((day, di) => {
                    const dateStr = day ? `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                    const hasEvent = hasSchedule(day);
                    const isToday = day && new Date().toDateString() === new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day).toDateString();
                    return (<td key={di} className={`calendar-day ${!day ? 'empty' : ''} ${hasEvent ? 'has-event' : ''} ${isToday ? 'today' : ''}`} onClick={() => { if (hasEvent) { const s = getScheduleForDate(dateStr); if (s) setSelectedSchedule(s); } }}>{day && <span className="day-number">{day}</span>}{hasEvent && <span className="event-dot"></span>}</td>);
                  })}</tr>
                ))}</tbody>
              </table>
            </div>
            <h3 style={{ margin: '20px 0 10px', color: 'var(--primary)' }}><i className="fas fa-clock"></i> Upcoming Services</h3>
            <div className="schedule-cards">
              {scheduleData.filter((s) => new Date(s.scheduleDate) >= new Date()).sort((a, b) => new Date(a.scheduleDate) - new Date(b.scheduleDate)).slice(0, 6).map((s, i) => (
                <div key={i} className={`upcoming-schedule-card${s.hasSubstitute ? ' has-sub' : ''}`} onClick={() => setSelectedSchedule(s)}>
                  <div className="schedule-card-date">{formatDate(s.scheduleDate)}</div>
                  <div className="schedule-card-leader"><i className="fas fa-microphone"></i> {s.hasSubstitute ? 'Song Leader (Substitute): ' : ''}{s.songLeader}</div>
                  {s.hasSubstitute && s.originalSongLeader && (
                    <div className="schedule-card-original"><i className="fas fa-user"></i> Song Leader: <span className="paw-grayed-out">{s.originalSongLeader}</span></div>
                  )}
                  <div className="schedule-card-songs">{s.slowSongs?.length || 0} slow • {s.fastSongs?.length || 0} fast songs</div>
                </div>
              ))}
              {scheduleData.filter((s) => new Date(s.scheduleDate) >= new Date()).length === 0 && <p style={{ color: '#6c757d' }}>No upcoming schedules found.</p>}
            </div>
            {todaysBirthdays.length > 0 && (
              <div className="birthday-section-v2">
                <h3 className="birthday-section-title"><i className="fas fa-birthday-cake"></i> Birthday Today! 🎂</h3>
                <div className="birthday-cards-grid">
                  {todaysBirthdays.map((b, i) => (
                    <div key={i} className="birthday-card-v2">
                      <div className="birthday-card-confetti"></div>
                      <div className="birthday-card-avatar">
                        {b.profile_picture ? (
                          <img src={b.profile_picture} alt={b.fullName} referrerPolicy="no-referrer" />
                        ) : (
                          <span className="birthday-card-initials">{b.firstname?.[0]}{b.lastname?.[0]}</span>
                        )}
                        <span className="birthday-cake-icon">🎂</span>
                      </div>
                      <div className="birthday-card-info">
                        <span className="birthday-card-name">{b.fullName}</span>
                        <span className="birthday-card-ministry"><i className="fas fa-church"></i> {b.ministry || 'Member'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ========== EVENTS ========== */}
          <section className={`content-section ${(activeSection === 'events' || activeSection === 'events-management') ? 'active' : ''}`}>
            <h2 className="section-title">Events</h2>

            {canManage(MODULES.CREATE_EVENTS) && featureOn('events.create') && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => { setShowEventForm(true); setEditingEvent(null); setEventForm({ title: '', description: '', eventDate: '', endDate: '', location: '' }); }}>
                <i className="fas fa-plus"></i> Create Event
              </button>
            )}

            {showEventForm && (
              <div className="form-card" style={{ marginBottom: 20, padding: 20, background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>{editingEvent ? 'Edit Event' : 'New Event'}</h3>
                <div className="form-group"><label>Title *</label><input className="form-control" style={{ padding: '10px 15px' }} value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} /></div>
                <div className="form-group"><label>Description</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={3} value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Event Date *</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={eventForm.eventDate} onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} /></div>
                  <div className="form-group"><label>End Date</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={eventForm.endDate} onChange={(e) => setEventForm({ ...eventForm, endDate: e.target.value })} /></div>
                </div>
                <div className="form-group"><label>Location</label><input className="form-control" style={{ padding: '10px 15px' }} value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleEventSubmit}><i className="fas fa-save"></i> {editingEvent ? 'Update' : 'Create'}</button>
                  <button className="btn-secondary" onClick={() => setShowEventForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div className="events-grid">
              {events.map((evt) => (
                <div key={evt.id} className="event-card" style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                  <h3 style={{ color: 'var(--primary)', marginBottom: 8 }}>{evt.title}</h3>
                  {evt.description && <p style={{ color: '#6c757d', marginBottom: 8 }}>{evt.description}</p>}
                  <p><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                  {evt.location && <p><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {canManage(MODULES.RSVP_EVENT) && featureOn('events.rsvp') && (
                      <>
                        <button className="btn-small btn-success" onClick={() => handleEventRSVP(evt.id, 'Going')}>Going</button>
                        <button className="btn-small btn-warning" onClick={() => handleEventRSVP(evt.id, 'Maybe')}>Maybe</button>
                        <button className="btn-small btn-secondary" onClick={() => handleEventRSVP(evt.id, 'Not Going')}>Not Going</button>
                      </>
                    )}
                    {canManage(MODULES.UPDATE_EVENTS) && featureOn('events.edit') && (
                      <button className="btn-small btn-primary" onClick={() => { setEditingEvent(evt); setEventForm({ title: evt.title, description: evt.description || '', eventDate: evt.event_date?.slice(0, 16), endDate: evt.end_date?.slice(0, 16) || '', location: evt.location || '' }); setShowEventForm(true); }}><i className="fas fa-edit"></i></button>
                    )}
                    {canManage(MODULES.DELETE_EVENTS) && featureOn('events.delete') && (
                      <button className="btn-small btn-danger" onClick={() => handleDeleteEvent(evt.id)}><i className="fas fa-trash"></i></button>
                    )}
                  </div>
                </div>
              ))}
              {events.length === 0 && <p style={{ color: '#6c757d' }}>No events found.</p>}
            </div>
          </section>

          {/* ========== ANNOUNCEMENTS ========== */}
          <section className={`content-section ${(activeSection === 'announcements' || activeSection === 'announcements-management') ? 'active' : ''}`}>
            <h2 className="section-title">Announcements</h2>

            {canManage(MODULES.CREATE_ANNOUNCEMENTS) && featureOn('announcements.create') && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => { setShowAnnouncementForm(true); setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', isPinned: false }); }}>
                <i className="fas fa-plus"></i> Create Announcement
              </button>
            )}

            {showAnnouncementForm && (
              <div className="form-card" style={{ marginBottom: 20, padding: 20, background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>{editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}</h3>
                <div className="form-group"><label>Title *</label><input className="form-control" style={{ padding: '10px 15px' }} value={announcementForm.title} onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })} /></div>
                <div className="form-group"><label>Content *</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={4} value={announcementForm.content} onChange={(e) => setAnnouncementForm({ ...announcementForm, content: e.target.value })} /></div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 15 }}><input type="checkbox" checked={announcementForm.isPinned} onChange={(e) => setAnnouncementForm({ ...announcementForm, isPinned: e.target.checked })} /> Pin this announcement</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleAnnouncementSubmit}><i className="fas fa-save"></i> {editingAnnouncement ? 'Update' : 'Create'}</button>
                  <button className="btn-secondary" onClick={() => setShowAnnouncementForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Birthday Announcements */}
            {todaysBirthdays.length > 0 && (
              <div className="birthday-section-v2">
                <h3 className="birthday-section-title"><i className="fas fa-birthday-cake"></i> Happy Birthday! 🎂</h3>
                <div className="birthday-cards-grid">
                  {todaysBirthdays.map((b, i) => (
                    <div key={i} className="birthday-card-v2 birthday-today">
                      <div className="birthday-card-confetti"></div>
                      <div className="birthday-card-avatar">
                        {b.profile_picture ? (
                          <img src={b.profile_picture} alt={b.fullName} referrerPolicy="no-referrer" />
                        ) : (
                          <span className="birthday-card-initials">{b.firstname?.[0]}{b.lastname?.[0]}</span>
                        )}
                        <span className="birthday-cake-icon">🎂</span>
                      </div>
                      <div className="birthday-card-info">
                        <span className="birthday-card-name">{b.fullName}</span>
                        <span className="birthday-card-ministry"><i className="fas fa-church"></i> {b.ministry || 'Member'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {announcements.map((ann) => (
              <div key={ann.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: ann.is_pinned ? '4px solid var(--accent)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ color: 'var(--primary)' }}>{ann.is_pinned && <i className="fas fa-thumbtack" style={{ marginRight: 8, color: 'var(--accent)' }}></i>}{ann.title}</h3>
                    <p style={{ color: '#6c757d', margin: '8px 0' }}>{ann.content}</p>
                    <small style={{ color: '#adb5bd' }}>By {ann.author_name || 'Admin'} • {formatDateTime(ann.created_at)}</small>
                  </div>
                  {canManage(MODULES.UPDATE_ANNOUNCEMENTS) && featureOn('announcements.edit') && (
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button className="btn-small btn-primary" onClick={() => { setEditingAnnouncement(ann); setAnnouncementForm({ title: ann.title, content: ann.content, isPinned: ann.is_pinned }); setShowAnnouncementForm(true); }}><i className="fas fa-edit"></i></button>
                      {canManage(MODULES.DELETE_ANNOUNCEMENTS) && featureOn('announcements.delete') && <button className="btn-small btn-danger" onClick={() => handleDeleteAnnouncement(ann.id)}><i className="fas fa-trash"></i></button>}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {upcomingBirthdays.length > 0 && (
              <div className="birthday-section-v2" style={{ marginTop: 20 }}>
                <h3 className="birthday-section-title"><i className="fas fa-calendar-alt"></i> Upcoming Birthdays (Next 30 Days)</h3>
                <div className="birthday-cards-grid">
                  {upcomingBirthdays.map((b, i) => (
                    <div key={i} className="birthday-card-v2 birthday-upcoming">
                      <div className="birthday-card-avatar">
                        {b.profile_picture ? (
                          <img src={b.profile_picture} alt={b.fullName} referrerPolicy="no-referrer" />
                        ) : (
                          <span className="birthday-card-initials">{b.firstname?.[0]}{b.lastname?.[0]}</span>
                        )}
                      </div>
                      <div className="birthday-card-info">
                        <span className="birthday-card-name">{b.fullName}</span>
                        <span className="birthday-card-date"><i className="fas fa-calendar"></i> {new Date(b.birthdate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</span>
                        {b.ministry && <span className="birthday-card-ministry"><i className="fas fa-church"></i> {b.ministry}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ========== MINISTRY MEETINGS ========== */}
          <section className={`content-section ${activeSection === 'ministry-meetings' ? 'active' : ''}`}>
            <h2 className="section-title">Ministry Meetings</h2>

            {canManage(MODULES.CREATE_MINISTRY_MEETING) && featureOn('meetings.create') && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => setShowMeetingForm(true)}>
                <i className="fas fa-plus"></i> Schedule Meeting
              </button>
            )}

            {showMeetingForm && (
              <div className="form-card" style={{ marginBottom: 20, padding: 20, background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>Schedule New Meeting</h3>
                <div className="form-group"><label>Title *</label><input className="form-control" style={{ padding: '10px 15px' }} value={meetingForm.title} onChange={(e) => setMeetingForm({ ...meetingForm, title: e.target.value })} /></div>
                <div className="form-group"><label>Description</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={3} value={meetingForm.description} onChange={(e) => setMeetingForm({ ...meetingForm, description: e.target.value })} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Date & Time *</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={meetingForm.meetingDate} onChange={(e) => setMeetingForm({ ...meetingForm, meetingDate: e.target.value })} /></div>
                  <div className="form-group"><label>Location</label><input className="form-control" style={{ padding: '10px 15px' }} value={meetingForm.location} onChange={(e) => setMeetingForm({ ...meetingForm, location: e.target.value })} /></div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleMeetingSubmit}><i className="fas fa-save"></i> Create</button>
                  <button className="btn-secondary" onClick={() => setShowMeetingForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {meetings.map((mtg) => (
              <div key={mtg.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                <h3 style={{ color: 'var(--primary)' }}>{mtg.title}</h3>
                {mtg.description && <p style={{ color: '#6c757d', margin: '8px 0' }}>{mtg.description}</p>}
                <p><i className="fas fa-clock"></i> {formatDateTime(mtg.meeting_date)} <span className={`badge badge-${mtg.status === 'Scheduled' ? 'primary' : mtg.status === 'Completed' ? 'success' : 'danger'}`} style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem' }}>{mtg.status}</span></p>
                {mtg.location && <p><i className="fas fa-map-marker-alt"></i> {mtg.location}</p>}
                <small style={{ color: '#adb5bd' }}>By {mtg.created_by_name} • {mtg.ministry}</small>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn-small btn-success" onClick={() => handleMeetingRSVP(mtg.id, 'Going')}>Going</button>
                  <button className="btn-small btn-warning" onClick={() => handleMeetingRSVP(mtg.id, 'Maybe')}>Maybe</button>
                  <button className="btn-small btn-secondary" onClick={() => handleMeetingRSVP(mtg.id, 'Not Going')}>Not Going</button>
                </div>
              </div>
            ))}
            {meetings.length === 0 && <p style={{ color: '#6c757d' }}>No upcoming meetings.</p>}
          </section>

          {/* ========== COMMUNITY HUB ========== */}
          <section className={`content-section ${activeSection === 'community-hub' ? 'active' : ''}`}>
            <h2 className="section-title">Community Hub</h2>

            {/* Kindness Disclaimer */}
            <div className="community-kindness-banner">
              <div className="community-kindness-icon">🕊️</div>
              <div className="community-kindness-text">
                <strong>Let&apos;s build each other up in love</strong>
                <p>&ldquo;Be kind and compassionate to one another, forgiving each other, just as in Christ God forgave you.&rdquo; — <em>Ephesians 4:32</em></p>
                <span className="community-kindness-reminder">Please keep posts uplifting, respectful, and God-honoring. This is a safe space for our church family 💛</span>
              </div>
            </div>

            {/* === FACEBOOK LIVE STREAM VIEWER === */}
            {liveStreams.filter(s => s.is_live && s.is_active).length > 0 && (
              <div className="live-stream-community-section">
                {liveStreams.filter(s => s.is_live && s.is_active).map((stream) => (
                  <div key={stream.id} className={`live-stream-card${liveStreamFullscreen ? ' fullscreen-mode' : ''}`} ref={liveStreamFullscreenRef}>
                    <div className="live-stream-card-header">
                      <div className="live-stream-badge-row">
                        <span className="live-badge-pulse"><i className="fas fa-circle"></i> LIVE</span>
                        <h3 className="live-stream-caption">{stream.caption || 'Sunday Service Live'}</h3>
                      </div>
                      <div className="live-stream-header-actions">
                        <button className="live-stream-share-btn" onClick={() => { setActiveLiveStream(stream); setShowLiveShareModal(true); setLiveShareCopied(false); }} title="Share Live Stream">
                          <i className="fas fa-share-alt"></i>
                          <span className="live-share-btn-label">Share</span>
                        </button>
                        {liveStreamFullscreen && (
                          <button className={`live-stream-chat-toggle-btn${liveStreamCommentsVisible ? ' active' : ''}`} onClick={() => setLiveStreamCommentsVisible(prev => !prev)} title={liveStreamCommentsVisible ? 'Hide Chat' : 'Show Chat'}>
                            <i className={`fas fa-comment${liveStreamCommentsVisible ? '-slash' : ''}`}></i>
                            <span className="live-chat-toggle-label">{liveStreamCommentsVisible ? 'Hide Chat' : 'Show Chat'}</span>
                          </button>
                        )}
                        <button className="live-stream-fullscreen-btn" onClick={toggleLiveStreamFullscreen} title={liveStreamFullscreen ? 'Exit Fullscreen' : 'Fullscreen & Landscape'}>
                          <i className={`fas fa-${liveStreamFullscreen ? 'compress' : 'expand'}`}></i>
                        </button>
                      </div>
                    </div>
                    <div className="live-stream-body-layout">
                      <div className="live-stream-video-area">
                        <div className="live-stream-video-wrapper">
                          <iframe src={extractIframeSrc(stream.iframe_url)} className="live-stream-iframe" allowFullScreen allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"></iframe>
                          {/* Floating hearts */}
                          <div className="live-stream-floating-hearts">
                            {liveStreamFloatingHearts.map(hId => (
                              <div key={hId} className="live-floating-heart"><i className="fas fa-heart"></i></div>
                            ))}
                          </div>
                        </div>
                        <div className="live-stream-card-footer">
                          <div className="live-stream-reactions-bar">
                            <button className={`live-stream-heart-btn${liveStreamUserReacted ? ' reacted' : ''}${liveStreamReactAnimating ? ' animating' : ''}`} onClick={() => { setActiveLiveStream(stream); handleLiveStreamReaction(); }}>
                              <i className={`${liveStreamUserReacted ? 'fas' : 'far'} fa-heart`}></i>
                              <span>{liveStreamReactionCount}</span>
                            </button>
                            <button className="live-stream-comment-toggle" onClick={() => { setActiveLiveStream(stream); setLiveStreamCommentsVisible(true); loadLiveStreamComments(stream.id); loadLiveStreamReactions(stream.id); }}>
                              <i className="far fa-comment"></i>
                              <span>Comments</span>
                            </button>
                          </div>
                          <span className="live-stream-posted-by">Posted by {stream.posted_by_name} • {formatDateTime(stream.created_at)}</span>
                        </div>
                      </div>

                    {/* Live Comments Section - Side Panel in Fullscreen */}
                    {activeLiveStream?.id === stream.id && liveStreamCommentsVisible && (
                      <div className="live-stream-comments-section">
                        <div className="live-stream-comments-header">
                          <h4><i className="fas fa-comments"></i> Live Chat</h4>
                          <span className="live-stream-comment-count">{liveStreamComments.reduce((acc, c) => acc + 1 + (c.replies?.length || 0), 0)} comments</span>
                        </div>
                        <div className="live-stream-comments-list">
                          {liveStreamComments.length === 0 && <p className="live-stream-no-comments">No comments yet. Be the first to chat! 💬</p>}
                          {liveStreamComments.map((comment) => (
                            <div key={comment.id} className="live-stream-comment">
                              <div className="live-stream-comment-avatar">
                                {comment.user_picture ? <img src={comment.user_picture} alt="" referrerPolicy="no-referrer" /> : <span>{comment.user_name?.split(' ').map(n => n[0]).join('').slice(0,2)}</span>}
                              </div>
                              <div className="live-stream-comment-body">
                                <div className="live-stream-comment-bubble">
                                  <strong>{comment.user_name}</strong>
                                  <p>{comment.content}</p>
                                </div>
                                <div className="live-stream-comment-actions">
                                  <span className="live-stream-comment-time">{formatDateTime(comment.created_at)}</span>
                                  <button className={`live-stream-comment-like${comment.liked ? ' liked' : ''}${liveStreamCommentLikeAnimating[comment.id] ? ' animating' : ''}`} onClick={() => handleLiveCommentLike(comment.id)}>
                                    <i className={`${comment.liked ? 'fas' : 'far'} fa-heart`}></i> {comment.likeCount > 0 && <span>{comment.likeCount}</span>}
                                  </button>
                                  <button className="live-stream-reply-btn" onClick={() => setLiveStreamReplyTo({ id: comment.id, user_name: comment.user_name })}>
                                    <i className="fas fa-reply"></i> Reply
                                  </button>
                                  {userData?.id === comment.user_id && (
                                    <button className="live-stream-delete-btn" onClick={() => handleDeleteLiveComment(comment.id)}>
                                      <i className="fas fa-trash-alt"></i>
                                    </button>
                                  )}
                                </div>
                                {/* Replies */}
                                {comment.replies && comment.replies.length > 0 && (
                                  <div className="live-stream-replies">
                                    {comment.replies.map((reply) => (
                                      <div key={reply.id} className="live-stream-comment reply">
                                        <div className="live-stream-comment-avatar small">
                                          {reply.user_picture ? <img src={reply.user_picture} alt="" referrerPolicy="no-referrer" /> : <span>{reply.user_name?.split(' ').map(n => n[0]).join('').slice(0,2)}</span>}
                                        </div>
                                        <div className="live-stream-comment-body">
                                          <div className="live-stream-comment-bubble reply-bubble">
                                            <strong>{reply.user_name}</strong>
                                            <p>{reply.content}</p>
                                          </div>
                                          <div className="live-stream-comment-actions">
                                            <span className="live-stream-comment-time">{formatDateTime(reply.created_at)}</span>
                                            <button className={`live-stream-comment-like${reply.liked ? ' liked' : ''}${liveStreamCommentLikeAnimating[reply.id] ? ' animating' : ''}`} onClick={() => handleLiveCommentLike(reply.id)}>
                                              <i className={`${reply.liked ? 'fas' : 'far'} fa-heart`}></i> {reply.likeCount > 0 && <span>{reply.likeCount}</span>}
                                            </button>
                                            {userData?.id === reply.user_id && (
                                              <button className="live-stream-delete-btn" onClick={() => handleDeleteLiveComment(reply.id)}>
                                                <i className="fas fa-trash-alt"></i>
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* Comment Input */}
                        <div className="live-stream-comment-input-area">
                          {liveStreamReplyTo && (
                            <div className="live-stream-reply-indicator">
                              <span>Replying to <strong>{liveStreamReplyTo.user_name}</strong></span>
                              <button onClick={() => setLiveStreamReplyTo(null)}><i className="fas fa-times"></i></button>
                            </div>
                          )}
                          <div className="live-stream-comment-input-row">
                            <div className="live-stream-input-avatar">
                              {userData?.profile_picture ? <img src={userData.profile_picture} alt="" referrerPolicy="no-referrer" /> : <span>{userData?.firstname?.[0]}{userData?.lastname?.[0]}</span>}
                            </div>
                            <input className="live-stream-comment-input" placeholder={liveStreamReplyTo ? `Reply to ${liveStreamReplyTo.user_name}...` : 'Write a comment...'} value={liveStreamCommentInput} onChange={(e) => setLiveStreamCommentInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleLiveStreamComment(); }} />
                            <button className="live-stream-send-btn" onClick={handleLiveStreamComment} disabled={!liveStreamCommentInput.trim()}>
                              <i className="fas fa-paper-plane"></i>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    </div>{/* end live-stream-body-layout */}
                  </div>
                ))}
              </div>
            )}

            {/* Live Stream Share Modal */}
            {showLiveShareModal && (
              <div className="live-share-modal-overlay" onClick={() => setShowLiveShareModal(false)}>
                <div className="live-share-modal" onClick={(e) => e.stopPropagation()}>
                  <button className="live-share-modal-close" onClick={() => setShowLiveShareModal(false)}><i className="fas fa-times"></i></button>
                  <div className="live-share-modal-header">
                    <div className="live-share-modal-icon">🔴</div>
                    <h3>Share Live Stream</h3>
                    <p>Invite others to watch {activeLiveStream?.caption || 'our live service'}</p>
                  </div>
                  <div className="live-share-modal-body">
                    <div className="live-share-preview">
                      <img src="/assets/LOGO.png" alt="JSCI" className="live-share-preview-logo" />
                      <div className="live-share-preview-info">
                        <span className="live-share-preview-badge"><i className="fas fa-circle"></i> LIVE</span>
                        <strong>{activeLiveStream?.caption || 'Sunday Service Live'}</strong>
                        <span>jsci.vercel.app/live</span>
                      </div>
                    </div>
                    <div className="live-share-buttons-grid">
                      <button className="live-share-option facebook" onClick={shareLiveToFacebook}><i className="fab fa-facebook-f"></i><span>Facebook</span></button>
                      <button className="live-share-option messenger" onClick={shareLiveToMessenger}><i className="fab fa-facebook-messenger"></i><span>Messenger</span></button>
                      <button className="live-share-option whatsapp" onClick={shareLiveToWhatsApp}><i className="fab fa-whatsapp"></i><span>WhatsApp</span></button>
                      <button className="live-share-option telegram" onClick={shareLiveToTelegram}><i className="fab fa-telegram-plane"></i><span>Telegram</span></button>
                      {typeof navigator !== 'undefined' && navigator.share && (
                        <button className="live-share-option native" onClick={shareLiveNative}><i className="fas fa-share-alt"></i><span>More</span></button>
                      )}
                    </div>
                    <div className="live-share-copy-row">
                      <div className="live-share-copy-input"><i className="fas fa-link"></i><input type="text" readOnly value={liveShareUrl} /></div>
                      <button className={`live-share-copy-btn${liveShareCopied ? ' copied' : ''}`} onClick={handleLiveShareCopyLink}><i className={`fas ${liveShareCopied ? 'fa-check' : 'fa-copy'}`}></i> {liveShareCopied ? 'Copied!' : 'Copy'}</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="community-layout">
              {/* Main feed */}
              <div className="community-feed">
                {canManage(MODULES.CREATE_POSTS) && featureOn('community.create_post') && (
                  <div className="community-compose">
                    <div className="community-compose-user">
                      <div className="community-compose-avatar">
                        {userData.profile_picture ? (
                          <img src={userData.profile_picture} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <span>{initials}</span>
                        )}
                      </div>
                      <span className="community-compose-name">{userData.firstname} {userData.lastname}</span>
                    </div>
                    <div className="community-compose-body">
                      <textarea className="community-compose-input" placeholder="Share something with the community..." rows={3} value={newPostContent} onChange={(e) => setNewPostContent(e.target.value)} />
                      <div className="community-compose-actions">
                        <button className="community-verse-share-btn" onClick={() => setShowVerseShareModal(true)} title="Share a Bible verse">
                          <i className="fas fa-bible"></i> <span className="verse-share-label">Bible Verse</span>
                        </button>
                        <button className="btn-primary community-post-btn" onClick={handleCreatePost} disabled={!newPostContent.trim()}>
                          <i className="fas fa-paper-plane"></i> Post
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {communityPosts.length === 0 && (
                  <div className="community-empty">
                    <i className="fas fa-comments"></i>
                    <p>No posts yet. Be the first to share!</p>
                  </div>
                )}

                {getAlgorithmSortedPosts(communityPosts).map((post, idx) => {
                  // Mark as viewed when rendered
                  if (!viewedPosts.includes(post.id)) {
                    setTimeout(() => markPostViewed(post.id), 1500);
                  }
                  return (
                  <div key={post.id} className={`community-post-card${post.is_pinned ? ' pinned' : ''}${deletingPost === post.id ? ' deleting' : ''}${!viewedPosts.includes(post.id) ? ' unseen' : ''}`} style={{ animationDelay: `${idx * 0.05}s` }}>
                    {post.is_pinned && <div className="community-pin-badge"><i className="fas fa-thumbtack"></i> Pinned</div>}
                    <div className="community-post-header">
                      <div className="community-post-author-avatar" onClick={() => handleViewProfile(post.author_id, post.author_name, post.author_picture)} style={{ cursor: 'pointer' }} title="View profile">
                        {post.author_picture ? (
                          <img src={post.author_picture} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <span>{post.author_name?.split(' ').map(n => n[0]).join('').slice(0,2)}</span>
                        )}
                      </div>
                      <div className="community-post-author-info">
                        <span className="community-post-author-name" onClick={() => handleViewProfile(post.author_id, post.author_name, post.author_picture)} style={{ cursor: 'pointer' }}>{post.author_name}</span>
                        <span className="community-post-time">{formatDateTime(post.created_at)}</span>
                      </div>
                      <div className="community-post-actions-top">
                        {(canManage(MODULES.PIN_POSTS) || userData?.id === post.author_id) && (
                          <div className="community-post-menu-wrapper">
                            <button className="community-action-btn" onClick={() => setPostMenuOpen(postMenuOpen === post.id ? null : post.id)} title="More options">
                              <i className="fas fa-ellipsis-h"></i>
                            </button>
                            {postMenuOpen === post.id && (
                              <div className="community-dropdown-menu" onClick={() => setPostMenuOpen(null)}>
                                {canManage(MODULES.PIN_POSTS) && (
                                  <button className="community-dropdown-item" onClick={() => handlePinPost(post.id, post.is_pinned)}>
                                    <i className={`fas fa-thumbtack`}></i> {post.is_pinned ? 'Unpin' : 'Pin Post'}
                                  </button>
                                )}
                                {userData?.id === post.author_id && (
                                  <>
                                    <button className="community-dropdown-item" onClick={() => { setEditingPost(post.id); setEditPostContent(post.content); }}>
                                      <i className="fas fa-edit"></i> Edit Post
                                    </button>
                                    <button className="community-dropdown-item delete" onClick={() => handleDeletePost(post.id)}>
                                      <i className="fas fa-trash-alt"></i> Delete Post
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {editingPost === post.id ? (
                      <div className="community-edit-box">
                        <textarea className="community-compose-input" value={editPostContent} onChange={(e) => setEditPostContent(e.target.value)} rows={3} />
                        <div className="community-edit-actions">
                          <button className="btn-primary btn-small" onClick={() => handleEditPost(post.id)}><i className="fas fa-check"></i> Save</button>
                          <button className="btn-secondary btn-small" onClick={() => { setEditingPost(null); setEditPostContent(''); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="community-post-content" style={{ whiteSpace: 'pre-wrap' }}>{post.content}</div>
                    )}

                    <div className="community-post-footer">
                      {featureOn('community.like_comment') && (
                        <button className={`community-react-btn${post.liked ? ' liked' : ''}${likeAnimating[post.id] ? ' animating' : ''}`} onClick={() => handleLikePost(post.id)}>
                          <i className={`${post.liked ? 'fas' : 'far'} fa-heart`}></i>
                          <span>{post.likeCount || 0}</span>
                        </button>
                      )}
                      {featureOn('community.like_comment') && (
                        <button className={`community-react-btn${showComments[post.id] ? ' active' : ''}`} onClick={() => { setShowComments((p) => ({ ...p, [post.id]: !p[post.id] })); if (!postComments[post.id]) loadPostComments(post.id); }}>
                          <i className="far fa-comment"></i>
                          <span>{post.commentCount || 0}</span>
                        </button>
                      )}
                    </div>

                    <div className={`community-comments-section${showComments[post.id] ? ' open' : ''}`}>
                      <div className="community-comments-inner">
                        {(postComments[post.id] || []).map((c) => (
                          <div key={c.id} className="community-comment">
                            <div className="community-comment-avatar" onClick={() => handleViewProfile(c.author_id, c.author_name, c.author_picture)} style={{ cursor: 'pointer' }}>
                              {c.author_picture ? (
                                <img src={c.author_picture} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                              ) : (
                                <span>{c.author_name?.split(' ').map(n => n[0]).join('').slice(0,2)}</span>
                              )}
                            </div>
                            <div className="community-comment-body">
                              {editingComment === c.id ? (
                                <div className="community-comment-edit-box">
                                  <input className="community-comment-input" value={editCommentContent} onChange={(e) => setEditCommentContent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleEditComment(c.id, post.id); }} />
                                  <div className="community-edit-actions" style={{ marginTop: 6 }}>
                                    <button className="btn-primary btn-small" onClick={() => handleEditComment(c.id, post.id)}><i className="fas fa-check"></i></button>
                                    <button className="btn-secondary btn-small" onClick={() => { setEditingComment(null); setEditCommentContent(''); }}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <div className="community-comment-bubble">
                                  <strong className="community-comment-name" onClick={() => handleViewProfile(c.author_id, c.author_name, c.author_picture)} style={{ cursor: 'pointer' }}>{c.author_name}</strong>
                                  <p className="community-comment-text">{c.content}</p>
                                </div>
                              )}
                              <div className="community-comment-actions-row">
                                <span className="community-comment-time">{formatDateTime(c.created_at)}</span>
                                <button className={`community-comment-like-btn${c.liked ? ' liked' : ''}${commentLikeAnimating[c.id] ? ' animating' : ''}`} onClick={() => handleLikeComment(c.id, post.id)}>
                                  <i className={`${c.liked ? 'fas' : 'far'} fa-heart`}></i> {c.likeCount > 0 && <span>{c.likeCount}</span>}
                                </button>
                                {userData?.id === c.author_id && (
                                  <div className="community-comment-own-actions">
                                    <button className="community-comment-action-btn" onClick={() => { setEditingComment(c.id); setEditCommentContent(c.content); setCommentMenuOpen(null); }} title="Edit"><i className="fas fa-edit"></i></button>
                                    <button className="community-comment-action-btn delete" onClick={() => handleDeleteComment(c.id, post.id)} title="Delete"><i className="fas fa-trash-alt"></i></button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        {(postComments[post.id] || []).length === 0 && <div className="community-no-comments">No comments yet</div>}
                        <div className="community-comment-input-row">
                          <input className="community-comment-input" placeholder="Write a comment..." value={commentInputs[post.id] || ''} onChange={(e) => setCommentInputs((p) => ({ ...p, [post.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(post.id); }} />
                          <button className="community-comment-send" onClick={() => handleAddComment(post.id)} disabled={!commentInputs[post.id]?.trim()}>
                            <i className="fas fa-paper-plane"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Sidebar cards */}
              <div className="community-sidebar">
                {/* Verse of the Hour */}
                <div className="community-card verse-card">
                  <div className="community-card-header">
                    <div className="community-card-icon verse-icon"><i className="fas fa-bible"></i></div>
                    <h3>Verse of the Hour</h3>
                  </div>
                  <div className="community-card-body">
                    <p className="verse-text">&ldquo;{currentVerse.text}&rdquo;</p>
                    <span className="verse-ref">— {currentVerse.ref}</span>
                  </div>
                  <div className="community-card-shimmer"></div>
                </div>

                {/* Fun Fact */}
                <div className="community-card fact-card">
                  <div className="community-card-header">
                    <div className="community-card-icon fact-icon"><i className="fas fa-lightbulb"></i></div>
                    <h3>Bible Fun Fact</h3>
                  </div>
                  <div className="community-card-body">
                    <span className="fact-emoji">{currentFact.emoji}</span>
                    <p className="fact-text">{currentFact.fact}</p>
                  </div>
                  <div className="community-card-shimmer"></div>
                </div>

                {/* Trivia */}
                <div className="community-card trivia-card">
                  <div className="community-card-header">
                    <div className="community-card-icon trivia-icon"><i className="fas fa-question-circle"></i></div>
                    <h3>Bible Trivia</h3>
                  </div>
                  <div className="community-card-body">
                    <p className="trivia-question"><i className="fas fa-question"></i> {currentTrivia.q}</p>
                    <details className="trivia-answer-toggle">
                      <summary>Reveal Answer</summary>
                      <p className="trivia-answer">{currentTrivia.a}</p>
                    </details>
                  </div>
                  <div className="community-card-shimmer"></div>
                </div>
              </div>
            </div>

            {/* Bible Verse Share Modal */}
            {showVerseShareModal && (
              <div className="community-verse-modal-overlay" onClick={() => setShowVerseShareModal(false)}>
                <div className="community-verse-modal" onClick={(e) => e.stopPropagation()}>
                  <button className="community-verse-modal-close" onClick={() => setShowVerseShareModal(false)}>
                    <i className="fas fa-times"></i>
                  </button>
                  <div className="community-verse-modal-header">
                    <div className="community-verse-modal-icon">📖</div>
                    <h3>Share a Bible Verse</h3>
                    <p>Look up a verse and share your reflection with the community</p>
                  </div>
                  <div className="community-verse-modal-body">
                    <div className="community-verse-search-row">
                      <div className="community-verse-search-input">
                        <i className="fas fa-search"></i>
                        <input
                          type="text"
                          placeholder='e.g. "John 3:16" or "Philippians 4:13"'
                          value={verseShareRef}
                          onChange={(e) => setVerseShareRef(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && loadVerseForShare()}
                        />
                      </div>
                      <button className="community-verse-load-btn" onClick={loadVerseForShare} disabled={verseShareLoading || !verseShareRef.trim()}>
                        {verseShareLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-book-open"></i>}
                        <span>{verseShareLoading ? 'Loading...' : 'Look Up'}</span>
                      </button>
                    </div>

                    {verseShareText && (
                      <div className="community-verse-preview">
                        <div className="community-verse-preview-badge"><i className="fas fa-bible"></i> {verseShareRef}</div>
                        <p className="community-verse-preview-text">&ldquo;{verseShareText}&rdquo;</p>
                      </div>
                    )}

                    {verseShareText && !verseShareText.includes('not found') && (
                      <div className="community-verse-reflection">
                        <label><i className="fas fa-heart"></i> Your Reflection <span>(optional)</span></label>
                        <textarea
                          placeholder="What does this verse mean to you? Share your thoughts..."
                          value={verseShareReflection}
                          onChange={(e) => setVerseShareReflection(e.target.value)}
                          rows={3}
                        />
                      </div>
                    )}
                  </div>
                  {verseShareText && !verseShareText.includes('not found') && (
                    <div className="community-verse-modal-footer">
                      <button className="community-verse-cancel-btn" onClick={() => setShowVerseShareModal(false)}>Cancel</button>
                      <button className="community-verse-post-btn" onClick={handleShareVersePost}>
                        <i className="fas fa-paper-plane"></i> Share Verse
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* View Profile Modal */}
            {viewingProfile && (
              <div className="community-profile-modal-overlay" onClick={() => setViewingProfile(null)}>
                <div className="community-profile-modal" onClick={(e) => e.stopPropagation()}>
                  <button className="community-profile-modal-close" onClick={() => setViewingProfile(null)}><i className="fas fa-times"></i></button>
                  <div className="community-profile-modal-banner"></div>
                  <div className="community-profile-modal-avatar">
                    {viewingProfile.profile_picture ? (
                      <img src={viewingProfile.profile_picture} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <span>{viewingProfile.author_name?.split(' ').map(n => n[0]).join('').slice(0,2)}</span>
                    )}
                  </div>
                  <div className="community-profile-modal-info">
                    <h3>{viewingProfile.author_name || `${viewingProfile.firstname} ${viewingProfile.lastname}`}</h3>
                    <span className="community-profile-role">{viewingProfile.role || viewingProfile.sub_role || 'Member'}</span>
                    {viewingProfile.ministry && <span className="community-profile-ministry"><i className="fas fa-church"></i> {viewingProfile.ministry}</span>}
                    {viewingProfile.life_verse && (
                      <div className="community-profile-verse">
                        <i className="fas fa-bible"></i> &ldquo;{viewingProfile.life_verse}&rdquo;
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ========== LIVE STREAM MANAGEMENT (Admin/SuperAdmin) ========== */}
          <section className={`content-section ${activeSection === 'live-stream-management' ? 'active' : ''}`}>
            <h2 className="section-title"><i className="fas fa-broadcast-tower" style={{ marginRight: 10, color: 'var(--accent)' }}></i>Live Stream Management</h2>

            <button className="btn-primary" style={{ marginBottom: 20, borderRadius: 22, padding: '10px 24px' }} onClick={() => { setShowLiveStreamForm(true); setEditingLiveStream(null); setLiveStreamForm({ iframe_url: '', caption: 'Sunday Service Live', title: 'Sunday Service Live' }); }}>
              <i className="fas fa-plus"></i> Post New Live Stream
            </button>

            {showLiveStreamForm && (
              <div className="live-admin-form-card">
                <div className="live-admin-form-header">
                  <div className="live-admin-form-icon">🎥</div>
                  <h3>{editingLiveStream ? 'Edit Live Stream' : 'Post Facebook Live to Community'}</h3>
                  <p>Paste the Facebook Live iframe embed code below</p>
                </div>
                <div className="live-admin-form-body">
                  <div className="form-group">
                    <label><i className="fas fa-code"></i> Facebook Iframe Embed Code *</label>
                    <textarea className="form-control live-admin-iframe-input" rows={4} placeholder='Paste iframe code from Facebook... e.g. <iframe src="https://www.facebook.com/plugins/video.php?..." ...></iframe>' value={liveStreamForm.iframe_url} onChange={(e) => setLiveStreamForm({ ...liveStreamForm, iframe_url: e.target.value })} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                    <div className="form-group">
                      <label><i className="fas fa-heading"></i> Title / Caption</label>
                      <input className="form-control" style={{ padding: '10px 15px' }} value={liveStreamForm.caption} onChange={(e) => setLiveStreamForm({ ...liveStreamForm, caption: e.target.value, title: e.target.value })} placeholder="Sunday Service Live" />
                    </div>
                    <div className="form-group">
                      <label><i className="fas fa-tag"></i> Custom Title</label>
                      <input className="form-control" style={{ padding: '10px 15px' }} value={liveStreamForm.title} onChange={(e) => setLiveStreamForm({ ...liveStreamForm, title: e.target.value })} placeholder="Sunday Service Live" />
                    </div>
                  </div>
                  {liveStreamForm.iframe_url && (
                    <div className="live-admin-preview">
                      <label><i className="fas fa-eye"></i> Preview</label>
                      <div className="live-admin-preview-frame">
                        <iframe src={extractIframeSrc(liveStreamForm.iframe_url)} style={{ width: '100%', height: 300, border: 'none', borderRadius: 12 }} allowFullScreen allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"></iframe>
                      </div>
                    </div>
                  )}
                </div>
                <div className="live-admin-form-footer">
                  <button className="btn-secondary" onClick={() => { setShowLiveStreamForm(false); setEditingLiveStream(null); }}>Cancel</button>
                  <button className="btn-primary" onClick={editingLiveStream ? () => handleUpdateLiveStream(editingLiveStream.id, { iframe_url: liveStreamForm.iframe_url, caption: liveStreamForm.caption, title: liveStreamForm.title }) : handleCreateLiveStream} disabled={liveStreamLoading}>
                    {liveStreamLoading ? <><i className="fas fa-spinner fa-spin"></i> Posting...</> : <><i className="fas fa-paper-plane"></i> {editingLiveStream ? 'Update' : 'Post to Community'}</>}
                  </button>
                </div>
              </div>
            )}

            {/* Live Streams Listing */}
            <div className="live-admin-list">
              <h3 style={{ marginBottom: 16, color: 'var(--text-primary)' }}><i className="fas fa-list"></i> All Live Streams ({liveStreams.length})</h3>
              {liveStreams.length === 0 && <p style={{ color: '#adb5bd', textAlign: 'center', padding: 40 }}>No live streams posted yet.</p>}
              {liveStreams.map((stream) => (
                <div key={stream.id} className={`live-admin-item${stream.is_live ? ' is-live' : ''}${!stream.is_active ? ' inactive' : ''}`}>
                  <div className="live-admin-item-header">
                    <div className="live-admin-item-status">
                      {stream.is_live ? <span className="live-badge-pulse"><i className="fas fa-circle"></i> LIVE</span> : <span className="live-badge-ended">Ended</span>}
                    </div>
                    <div className="live-admin-item-info">
                      <h4>{stream.caption || stream.title || 'Sunday Service Live'}</h4>
                      <span className="live-admin-item-meta">Posted by {stream.posted_by_name} • {formatDateTime(stream.created_at)}</span>
                    </div>
                    <div className="live-admin-item-stats">
                      <span><i className="fas fa-heart" style={{ color: '#e74c3c' }}></i> {stream.reactionCount || 0}</span>
                      <span><i className="fas fa-comment" style={{ color: 'var(--primary)' }}></i> {stream.commentCount || 0}</span>
                    </div>
                  </div>
                  <div className="live-admin-item-actions">
                    <button className={`btn-small ${stream.is_live ? 'btn-danger' : 'btn-success'}`} onClick={() => handleUpdateLiveStream(stream.id, { is_live: !stream.is_live })}>
                      <i className={`fas fa-${stream.is_live ? 'stop' : 'play'}`}></i> {stream.is_live ? 'End Live' : 'Set Live'}
                    </button>
                    <button className="btn-small btn-primary" onClick={() => { setEditingLiveStream(stream); setLiveStreamForm({ iframe_url: stream.iframe_url, caption: stream.caption, title: stream.title }); setShowLiveStreamForm(true); }}>
                      <i className="fas fa-edit"></i> Edit
                    </button>
                    <button className={`btn-small ${stream.is_active ? 'btn-warning' : 'btn-success'}`} onClick={() => handleUpdateLiveStream(stream.id, { is_active: !stream.is_active })}>
                      <i className={`fas fa-${stream.is_active ? 'eye-slash' : 'eye'}`}></i> {stream.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button className="btn-small btn-danger" onClick={() => handleDeleteLiveStream(stream.id)}>
                      <i className="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ========== MESSAGES ========== */}
          <section className={`content-section ${activeSection === 'messages' ? 'active' : ''}`}>
            <h2 className="section-title">Messages</h2>

            <div style={{ display: 'flex', gap: 10, marginBottom: 15, flexWrap: 'wrap' }}>
              {['inbox', 'sent', 'broadcast'].map((tab) => (
                <button key={tab} className={`btn-small ${messageTab === tab ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setMessageTab(tab); setTimeout(loadMessages, 100); }}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
              {featureOn('messages.send') && (
                <button className="btn-primary" onClick={() => { setShowMessageForm(true); if (allUsers.length === 0) loadAdminUsers(); }}>
                  <i className="fas fa-pen"></i> Compose
                </button>
              )}
              {canManage(MODULES.SEND_BROADCASTS) && featureOn('messages.broadcast') && (
                <button className="btn-warning" onClick={() => { setShowMessageForm(true); setMessageForm((p) => ({ ...p, isBroadcast: true })); }}>
                  <i className="fas fa-broadcast-tower"></i> Broadcast
                </button>
              )}
            </div>

            {showMessageForm && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>{messageForm.isBroadcast ? 'Send Broadcast' : 'New Message'}</h3>
                {!messageForm.isBroadcast && (
                  <div className="form-group"><label>To</label>
                    <select className="form-select" style={{ padding: '10px 15px' }} value={messageForm.receiverId} onChange={(e) => setMessageForm({ ...messageForm, receiverId: e.target.value })}>
                      <option value="">Select recipient</option>
                      {allUsers.filter((u) => u.id !== userData?.id).map((u) => (<option key={u.id} value={u.id}>{u.firstname} {u.lastname} ({u.role})</option>))}
                    </select>
                  </div>
                )}
                <div className="form-group"><label>Subject</label><input className="form-control" style={{ padding: '10px 15px' }} value={messageForm.subject} onChange={(e) => setMessageForm({ ...messageForm, subject: e.target.value })} /></div>
                <div className="form-group"><label>Message *</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={4} value={messageForm.content} onChange={(e) => setMessageForm({ ...messageForm, content: e.target.value })} /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleSendMessage}><i className="fas fa-paper-plane"></i> Send</button>
                  <button className="btn-secondary" onClick={() => { setShowMessageForm(false); setMessageForm({ receiverId: '', subject: '', content: '', isBroadcast: false, broadcastTarget: 'all' }); }}>Cancel</button>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} style={{ padding: 15, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', opacity: msg.is_read ? 0.8 : 1, borderLeft: msg.is_read ? 'none' : '3px solid var(--accent)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{msg.subject || '(No subject)'}</strong>
                  <small style={{ color: '#adb5bd' }}>{formatDateTime(msg.created_at)}</small>
                </div>
                <p style={{ margin: '8px 0', color: '#6c757d' }}>{msg.content}</p>
                {msg.is_broadcast && <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12, background: 'rgba(255,195,0,0.2)', color: 'var(--accent)' }}>Broadcast</span>}
              </div>
            ))}
            {messages.length === 0 && <p style={{ color: '#6c757d' }}>No messages.</p>}
          </section>

          {/* ========== ATTENDANCE MANAGEMENT ========== */}
          <section className={`content-section ${activeSection === 'attendance-management' ? 'active' : ''}`}>
            <h2 className="section-title">Attendance Management</h2>

            <div style={{ display: 'flex', gap: 15, marginBottom: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Date</label>
                <input type="date" className="form-control" style={{ padding: '10px 15px' }} value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={loadAttendance}>Load</button>
            </div>

            {canManage(MODULES.MARK_ATTENDANCE) && featureOn('attendance.mark') && adminUsers.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ marginBottom: 10 }}>Quick Mark</h3>
                <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={{ padding: 8, borderBottom: '2px solid #dee2e6', textAlign: 'left' }}>Member</th><th style={{ padding: 8, borderBottom: '2px solid #dee2e6' }}>Ministry</th><th style={{ padding: 8, borderBottom: '2px solid #dee2e6' }}>Action</th></tr></thead>
                    <tbody>
                      {adminUsers.filter((u) => u.status === 'Verified').map((u) => (
                        <tr key={u.id}>
                          <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{u.firstname} {u.lastname}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{u.ministry}</td>
                          <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                            <div style={{ display: 'flex', gap: 5 }}>
                              <button className="btn-small btn-success" onClick={() => handleMarkAttendance(u.id, 'Present')}>P</button>
                              <button className="btn-small btn-danger" onClick={() => handleMarkAttendance(u.id, 'Absent')}>A</button>
                              <button className="btn-small btn-warning" onClick={() => handleMarkAttendance(u.id, 'Late')}>L</button>
                              <button className="btn-small btn-secondary" onClick={() => handleMarkAttendance(u.id, 'Excused')}>E</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <h3 style={{ marginBottom: 10 }}>Records for {attendanceDate}</h3>
            {attendanceRecords.map((rec) => (
              <div key={rec.id} style={{ padding: 12, background: 'var(--bg-card)', borderRadius: 8, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{rec.users?.firstname} {rec.users?.lastname} ({rec.users?.ministry})</span>
                <span className={`badge badge-${rec.status === 'Present' ? 'success' : rec.status === 'Absent' ? 'danger' : rec.status === 'Late' ? 'warning' : 'secondary'}`} style={{ padding: '4px 12px', borderRadius: 12, fontWeight: 600 }}>{rec.status}</span>
              </div>
            ))}
            {attendanceRecords.length === 0 && <p style={{ color: '#6c757d' }}>No attendance records for this date.</p>}
          </section>

          {/* ========== MINISTRY OVERSIGHT (Pastor) ========== */}
          <section className={`content-section ${activeSection === 'ministry-oversight' ? 'active' : ''}`}>
            <h2 className="section-title">Ministry Oversight</h2>
            {ministriesList.map((min) => (
              <div key={min.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                <h3 style={{ color: 'var(--primary)' }}>{min.name}</h3>
                {min.description && <p style={{ color: '#6c757d' }}>{min.description}</p>}
                {min.leader_name && <p><i className="fas fa-user-tie"></i> Leader: {min.leader_name}</p>}
                <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 12, background: min.is_active ? 'rgba(40,167,69,0.2)' : 'rgba(220,53,69,0.2)', color: min.is_active ? '#28a745' : '#dc3545' }}>
                  {min.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
            {ministriesList.length === 0 && <p style={{ color: '#6c757d' }}>No ministries found.</p>}
          </section>

          {/* ========== REPORTS ========== */}
          <section className={`content-section ${activeSection === 'reports' ? 'active' : ''}`}>
            <h2 className="section-title">Reports</h2>

            {reportData && dashboardType !== 'ministry' && (
              <div className="stats-container" style={{ marginBottom: 20 }}>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-users"></i></div><div className="stat-value">{reportData.totalUsers || 0}</div><div className="stat-label">Total Users</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-user-check"></i></div><div className="stat-value">{reportData.verifiedUsers || 0}</div><div className="stat-label">Verified Users</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-calendar"></i></div><div className="stat-value">{reportData.totalEvents || 0}</div><div className="stat-label">Events</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-music"></i></div><div className="stat-value">{reportData.totalSchedules || 0}</div><div className="stat-label">Schedules</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-bullhorn"></i></div><div className="stat-value">{reportData.totalAnnouncements || 0}</div><div className="stat-label">Announcements</div></div>
                <div className="stat-card"><div className="stat-icon"><i className="fas fa-comments"></i></div><div className="stat-value">{reportData.totalPosts || 0}</div><div className="stat-label">Community Posts</div></div>
              </div>
            )}

            {reportData && dashboardType !== 'ministry' && reportData.roleDistribution && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 15, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                <h3 style={{ color: 'var(--primary)', marginBottom: 15 }}>Users by Role</h3>
                {Object.entries(reportData.roleDistribution).map(([role, count]) => (
                  <div key={role} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                    <span>{role}</span><strong>{count}</strong>
                  </div>
                ))}
              </div>
            )}

            {reportData && dashboardType === 'ministry' && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 15 }}>
                <h3 style={{ color: 'var(--primary)', marginBottom: 15 }}>Your Attendance Summary</h3>
                {reportData.summary && Object.entries(reportData.summary).map(([status, count]) => (
                  <div key={status} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                    <span>{status}</span><strong>{count}</strong>
                  </div>
                ))}
              </div>
            )}

            {!reportData && <p style={{ color: '#6c757d' }}>Loading reports...</p>}
          </section>

          {/* ========== USER MANAGEMENT (Admin/Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'user-management' ? 'active' : ''}`}>
            <h2 className="section-title">User Management</h2>

            {featureOn('users.create') && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => { setShowUserForm(true); setEditingUser(null); setUserForm({ firstname: '', lastname: '', email: '', password: '', ministry: '', sub_role: '', role: 'Guest' }); }}>
                <i className="fas fa-plus"></i> Create User
              </button>
            )}

            {showUserForm && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>Create New User</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>First Name *</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.firstname} onChange={(e) => setUserForm({ ...userForm, firstname: e.target.value })} /></div>
                  <div className="form-group"><label>Last Name *</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.lastname} onChange={(e) => setUserForm({ ...userForm, lastname: e.target.value })} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Email Address *</label><input className="form-control" type="email" style={{ padding: '10px 15px' }} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></div>
                  <div className="form-group"><label>Password *</label><input className="form-control" type="password" style={{ padding: '10px 15px' }} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Ministry</label>
                    <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.ministry} onChange={(e) => setUserForm({ ...userForm, ministry: e.target.value, sub_role: '' })}>
                      <option value="">— No Ministry —</option>
                      {ALL_MINISTRIES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>Ministry Roles</label>
                    <div className="um-role-tags-wrapper">
                      <div className="um-role-tags">
                        {(userForm.sub_role ? userForm.sub_role.split(',').map(s => s.trim()).filter(Boolean) : []).map((role, i) => (
                          <span key={i} className="um-role-tag">{role}<button type="button" onClick={() => { const roles = userForm.sub_role.split(',').map(s => s.trim()).filter(Boolean); roles.splice(i, 1); setUserForm({ ...userForm, sub_role: roles.join(', ') }); }}>&times;</button></span>
                        ))}
                      </div>
                      <div className="um-role-add-row">
                        <input className="form-control um-role-add-input" list="create-sub-roles" placeholder="Type or select a role..." value={newSubRoleInput} onChange={(e) => setNewSubRoleInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const val = newSubRoleInput.trim(); if (val) { const current = userForm.sub_role ? userForm.sub_role.split(',').map(s => s.trim()).filter(Boolean) : []; if (!current.includes(val)) { setUserForm({ ...userForm, sub_role: [...current, val].join(', ') }); } setNewSubRoleInput(''); } } }} />
                        <datalist id="create-sub-roles">
                          {(MINISTRY_SUB_ROLES[userForm.ministry] || []).filter(sr => !(userForm.sub_role || '').split(',').map(s => s.trim()).includes(sr)).map((sr) => <option key={sr} value={sr} />)}
                        </datalist>
                        <button type="button" className="um-role-add-btn" onClick={() => { const val = newSubRoleInput.trim(); if (val) { const current = userForm.sub_role ? userForm.sub_role.split(',').map(s => s.trim()).filter(Boolean) : []; if (!current.includes(val)) { setUserForm({ ...userForm, sub_role: [...current, val].join(', ') }); } setNewSubRoleInput(''); } }}><i className="fas fa-plus"></i> Add</button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="form-group" style={{ marginBottom: 15 }}><label>System Role</label>
                  <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                    {((userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN) ? ALL_ROLES : ALL_ROLES.filter((r) => r !== 'Super Admin')).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleCreateUser}><i className="fas fa-save"></i> Create</button>
                  <button className="btn-secondary" onClick={() => setShowUserForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Edit User Modal */}
            {showEditModal && editingUser && (
              <div className="edit-user-modal-overlay" onClick={() => setShowEditModal(false)}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-user-edit"></i> Edit User</h3>
                    <button className="btn-close-modal" onClick={() => setShowEditModal(false)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                      <div className="form-group"><label>First Name</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.firstname} onChange={(e) => setUserForm({ ...userForm, firstname: e.target.value })} /></div>
                      <div className="form-group"><label>Last Name</label><input className="form-control" style={{ padding: '10px 15px' }} value={userForm.lastname} onChange={(e) => setUserForm({ ...userForm, lastname: e.target.value })} /></div>
                    </div>
                    <div className="form-group"><label>Email</label><input className="form-control" style={{ padding: '10px 15px', background: '#f0f0f0' }} value={userForm.email} disabled /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                      <div className="form-group"><label>Ministry</label>
                        <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.ministry} onChange={(e) => setUserForm({ ...userForm, ministry: e.target.value, sub_role: '' })}>
                          <option value="">— No Ministry —</option>
                          {ALL_MINISTRIES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label>Ministry Roles</label>
                        <div className="um-role-tags-wrapper">
                          <div className="um-role-tags">
                            {(userForm.sub_role ? userForm.sub_role.split(',').map(s => s.trim()).filter(Boolean) : []).map((role, i) => (
                              <span key={i} className="um-role-tag">{role}<button type="button" onClick={() => { const roles = userForm.sub_role.split(',').map(s => s.trim()).filter(Boolean); roles.splice(i, 1); setUserForm({ ...userForm, sub_role: roles.join(', ') }); }}>&times;</button></span>
                            ))}
                          </div>
                          <div className="um-role-add-row">
                            <input className="form-control um-role-add-input" list="edit-sub-roles" placeholder="Type or select a role..." value={newSubRoleInput} onChange={(e) => setNewSubRoleInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const val = newSubRoleInput.trim(); if (val) { const current = userForm.sub_role ? userForm.sub_role.split(',').map(s => s.trim()).filter(Boolean) : []; if (!current.includes(val)) { setUserForm({ ...userForm, sub_role: [...current, val].join(', ') }); } setNewSubRoleInput(''); } } }} />
                            <datalist id="edit-sub-roles">
                              {(MINISTRY_SUB_ROLES[userForm.ministry] || []).filter(sr => !(userForm.sub_role || '').split(',').map(s => s.trim()).includes(sr)).map((sr) => <option key={sr} value={sr} />)}
                            </datalist>
                            <button type="button" className="um-role-add-btn" onClick={() => { const val = newSubRoleInput.trim(); if (val) { const current = userForm.sub_role ? userForm.sub_role.split(',').map(s => s.trim()).filter(Boolean) : []; if (!current.includes(val)) { setUserForm({ ...userForm, sub_role: [...current, val].join(', ') }); } setNewSubRoleInput(''); } }}><i className="fas fa-plus"></i> Add</button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="form-group"><label>System Role</label>
                      <select className="form-select" style={{ padding: '10px 15px' }} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                        {((userRole === ROLES.SUPER_ADMIN || userRole === ROLES.ADMIN) ? ALL_ROLES : ALL_ROLES.filter((r) => r !== 'Super Admin')).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="edit-user-modal-footer">
                    <button className="btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
                    <button className="btn-primary" onClick={handleUpdateUser}><i className="fas fa-save"></i> Save Changes</button>
                  </div>
                </div>
              </div>
            )}

            {/* Event Permissions Modal */}
            {eventPermissionsUser && (
              <div className="edit-user-modal-overlay" onClick={() => setEventPermissionsUser(null)}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-calendar-check"></i> Event Creation Permissions</h3>
                    <button className="btn-close-modal" onClick={() => setEventPermissionsUser(null)}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body">
                    <div style={{ padding: '12px 16px', background: 'rgba(0,123,255,0.05)', borderRadius: 10, marginBottom: 15, border: '1px solid rgba(0,123,255,0.15)' }}>
                      <strong>{eventPermissionsUser.firstname} {eventPermissionsUser.lastname}</strong>
                      <div style={{ fontSize: '0.85rem', color: '#6c757d' }}>{eventPermissionsUser.email} • {eventPermissionsUser.role}</div>
                    </div>
                    <p style={{ marginBottom: 12, fontSize: '0.9rem', color: '#6c757d' }}>
                      Select which types of events this user can create. When enabled, a &quot;My Events&quot; section will appear in their sidebar.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {USER_EVENT_TYPES.map((type) => {
                        const isChecked = eventPermissionsForm.includes(type);
                        return (
                          <label key={type} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                            borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s',
                            background: isChecked ? 'rgba(40,167,69,0.08)' : 'var(--bg-card)',
                            border: isChecked ? '2px solid #28a745' : '2px solid #dee2e6',
                          }}>
                            <input type="checkbox" checked={isChecked} onChange={() => {
                              setEventPermissionsForm((prev) =>
                                isChecked ? prev.filter((t) => t !== type) : [...prev, type]
                              );
                            }} style={{ accentColor: '#28a745' }} />
                            <span style={{ fontWeight: isChecked ? 600 : 400, color: isChecked ? '#28a745' : 'inherit' }}>{type}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
                      <button className="btn-small" style={{ fontSize: '0.8rem', color: '#28a745', background: 'rgba(40,167,69,0.1)', border: '1px solid rgba(40,167,69,0.3)', padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}
                        onClick={() => setEventPermissionsForm([...USER_EVENT_TYPES])}>Select All</button>
                      <button className="btn-small" style={{ fontSize: '0.8rem', color: '#dc3545', background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.3)', padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}
                        onClick={() => setEventPermissionsForm([])}>Clear All</button>
                    </div>
                  </div>
                  <div className="edit-user-modal-footer">
                    <button className="btn-secondary" onClick={() => setEventPermissionsUser(null)}>Cancel</button>
                    <button className="btn-primary" onClick={() => handleUpdateEventPermissions(eventPermissionsUser.id, eventPermissionsForm)}>
                      <i className="fas fa-save"></i> Save Permissions
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Search & Filters */}
            <div className="um-toolbar">
              <div className="um-search-box">
                <i className="fas fa-search um-search-icon"></i>
                <input type="text" className="um-search-input" placeholder="Search by name, email, or member ID..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
                {userSearch && <button className="um-search-clear" onClick={() => setUserSearch('')}><i className="fas fa-times"></i></button>}
              </div>
              <div className="um-filters">
                <select className="um-filter-select" value={userFilterRole} onChange={(e) => setUserFilterRole(e.target.value)}>
                  <option value="">All Roles</option>
                  {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="um-filter-select" value={userFilterMinistry} onChange={(e) => setUserFilterMinistry(e.target.value)}>
                  <option value="">All Ministries</option>
                  {ALL_MINISTRIES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select className="um-filter-select" value={userFilterStatus} onChange={(e) => setUserFilterStatus(e.target.value)}>
                  <option value="">All Status</option>
                  <option value="Verified">Verified</option>
                  <option value="Unverified">Unverified</option>
                  <option value="Deactivated">Deactivated</option>
                </select>
                {(userFilterRole || userFilterMinistry || userFilterStatus) && (
                  <button className="um-clear-filters" onClick={() => { setUserFilterRole(''); setUserFilterMinistry(''); setUserFilterStatus(''); }}>
                    <i className="fas fa-times"></i> Clear Filters
                  </button>
                )}
              </div>
            </div>

            <div className="um-results-count">
              Showing <strong>{filteredAdminUsers.length}</strong> of <strong>{adminUsers.length}</strong> users
            </div>

            {/* User Table */}
            <div className="um-table-wrapper">
              <table className="um-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Member ID</th>
                    <th>Ministry</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th style={{ width: 60, textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAdminUsers.map((u) => (
                    <tr key={u.id} className={u.is_active === false ? 'um-row-deactivated' : ''}>
                      <td>
                        <div className="um-user-cell">
                          <div className="um-avatar">
                            {u.profile_picture ? (
                              <img src={u.profile_picture} alt="" />
                            ) : (
                              <span>{(u.firstname?.[0] || '')}{(u.lastname?.[0] || '')}</span>
                            )}
                          </div>
                          <div className="um-user-info">
                            <div className="um-user-name">{u.firstname} {u.lastname}</div>
                            <div className="um-user-email">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className="um-member-id">{u.member_id}</span></td>
                      <td>
                        {u.ministry ? (
                          <div className="um-ministry-cell">
                            <span className="ministry-badge">{u.ministry}</span>
                            {u.sub_role && u.sub_role.split(',').map(s => s.trim()).filter(Boolean).map((sr, i) => (
                              <span key={i} className="sub-role-badge">{sr}</span>
                            ))}
                          </div>
                        ) : <span className="um-empty">—</span>}
                      </td>
                      <td>
                        {canManage(MODULES.ASSIGN_USER_ROLES) ? (
                          <select className="um-role-select" value={u.role} onChange={(e) => setConfirmAction({ type: 'assign-role', userId: u.id, userName: `${u.firstname} ${u.lastname}`, action: 'assign-role', extra: { role: e.target.value }, label: `Change role to "${e.target.value}"` })}>
                            {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        ) : <span className="um-role-pill">{u.role}</span>}
                      </td>
                      <td>
                        <span className={`um-status-badge um-status-${u.status?.toLowerCase()}`}>{u.status}</span>
                      </td>
                      <td style={{ position: 'relative', textAlign: 'center' }}>
                        <button className="um-dots-btn" onClick={(e) => { e.stopPropagation(); setUserActionMenu(userActionMenu === u.id ? null : u.id); }}>
                          <i className="fas fa-ellipsis-v"></i>
                        </button>
                        {userActionMenu === u.id && (
                          <div className="um-dropdown" onClick={(e) => e.stopPropagation()}>
                            <button className="um-dropdown-item" onClick={() => { handleEditUser(u); setUserActionMenu(null); }}>
                              <i className="fas fa-user-edit"></i> Edit User
                            </button>
                            <button className="um-dropdown-item" onClick={() => { setEventPermissionsUser(u); setEventPermissionsForm(u.allowed_event_types || []); setUserActionMenu(null); }}>
                              <i className="fas fa-calendar-check"></i> Event Permissions
                            </button>
                            <div className="um-dropdown-divider"></div>
                            {u.status === 'Unverified' && (
                              <button className="um-dropdown-item um-item-success" onClick={() => { setConfirmAction({ type: 'verify', userId: u.id, userName: `${u.firstname} ${u.lastname}`, label: 'verify this user' }); setUserActionMenu(null); }}>
                                <i className="fas fa-check-circle"></i> Verify User
                              </button>
                            )}
                            {u.is_active !== false && (
                              <button className="um-dropdown-item um-item-warning" onClick={() => { setConfirmAction({ type: 'deactivate', userId: u.id, userName: `${u.firstname} ${u.lastname}`, label: 'deactivate this user' }); setUserActionMenu(null); }}>
                                <i className="fas fa-ban"></i> Deactivate
                              </button>
                            )}
                            {u.is_active === false && (
                              <button className="um-dropdown-item um-item-success" onClick={() => { setConfirmAction({ type: 'activate', userId: u.id, userName: `${u.firstname} ${u.lastname}`, label: 'activate this user' }); setUserActionMenu(null); }}>
                                <i className="fas fa-check-circle"></i> Activate
                              </button>
                            )}
                            <button className="um-dropdown-item" onClick={() => { setShowResetPwModal(u); setResetPwForm({ newPassword: '', confirmPassword: '' }); setUserActionMenu(null); }}>
                              <i className="fas fa-key"></i> Reset Password
                            </button>
                            {canManage(MODULES.DELETE_USERS) && (
                              <>
                                <div className="um-dropdown-divider"></div>
                                <button className="um-dropdown-item um-item-danger" onClick={() => { setConfirmAction({ type: 'delete', userId: u.id, userName: `${u.firstname} ${u.lastname}`, label: 'permanently delete this user' }); setUserActionMenu(null); }}>
                                  <i className="fas fa-trash-alt"></i> Delete User
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredAdminUsers.length === 0 && <div className="um-empty-state"><i className="fas fa-users-slash"></i><p>No users found matching your criteria.</p></div>}

            {/* Confirmation Modal */}
            {confirmAction && (
              <div className="um-modal-overlay" onClick={() => setConfirmAction(null)}>
                <div className="um-confirm-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="um-confirm-icon">
                    <i className={`fas ${confirmAction.type === 'delete' ? 'fa-exclamation-triangle' : confirmAction.type === 'deactivate' ? 'fa-ban' : 'fa-question-circle'}`}></i>
                  </div>
                  <h3 className="um-confirm-title">Are you sure?</h3>
                  <p className="um-confirm-text">
                    You are about to <strong>{confirmAction.label}</strong> for <strong>{confirmAction.userName}</strong>.
                    {confirmAction.type === 'delete' && <><br /><span className="um-confirm-warning">This action cannot be undone.</span></>}
                  </p>
                  <div className="um-confirm-actions">
                    <button className="um-btn-cancel" onClick={() => setConfirmAction(null)}>Cancel</button>
                    <button className={`um-btn-confirm ${confirmAction.type === 'delete' ? 'um-btn-confirm-danger' : confirmAction.type === 'deactivate' ? 'um-btn-confirm-warning' : 'um-btn-confirm-success'}`}
                      onClick={() => {
                        if (confirmAction.type === 'delete') handleDeleteUser(confirmAction.userId);
                        else if (confirmAction.type === 'assign-role') handleUserAction(confirmAction.userId, 'assign-role', confirmAction.extra);
                        else handleUserAction(confirmAction.userId, confirmAction.type);
                      }}>
                      Yes, {confirmAction.type === 'delete' ? 'Delete' : confirmAction.type === 'deactivate' ? 'Deactivate' : confirmAction.type === 'activate' ? 'Activate' : confirmAction.type === 'verify' ? 'Verify' : 'Confirm'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Reset Password Modal */}
            {showResetPwModal && (
              <div className="um-modal-overlay" onClick={() => { setShowResetPwModal(null); setResetPwForm({ newPassword: '', confirmPassword: '' }); }}>
                <div className="um-reset-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="um-reset-header">
                    <h3><i className="fas fa-key"></i> Reset Password</h3>
                    <button className="btn-close-modal" onClick={() => { setShowResetPwModal(null); setResetPwForm({ newPassword: '', confirmPassword: '' }); }}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="um-reset-body">
                    <div className="um-reset-user-info">
                      <div className="um-avatar" style={{ width: 40, height: 40, fontSize: '0.85rem' }}>
                        {showResetPwModal.profile_picture ? <img src={showResetPwModal.profile_picture} alt="" /> : <span>{(showResetPwModal.firstname?.[0] || '')}{(showResetPwModal.lastname?.[0] || '')}</span>}
                      </div>
                      <div>
                        <strong>{showResetPwModal.firstname} {showResetPwModal.lastname}</strong>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary, #6c757d)' }}>{showResetPwModal.email}</div>
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 14 }}>
                      <label>New Password</label>
                      <div className="um-pw-field">
                        <input className="form-control" type={showResetPw.new ? 'text' : 'password'} placeholder="Enter new password (min 8 chars)" value={resetPwForm.newPassword} onChange={(e) => setResetPwForm({ ...resetPwForm, newPassword: e.target.value })} style={{ padding: '10px 40px 10px 15px' }} />
                        <button type="button" className="um-pw-toggle" onClick={() => setShowResetPw({ ...showResetPw, new: !showResetPw.new })}>
                          <i className={`fas ${showResetPw.new ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                        </button>
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Confirm Password</label>
                      <div className="um-pw-field">
                        <input className="form-control" type={showResetPw.confirm ? 'text' : 'password'} placeholder="Confirm new password" value={resetPwForm.confirmPassword} onChange={(e) => setResetPwForm({ ...resetPwForm, confirmPassword: e.target.value })} style={{ padding: '10px 40px 10px 15px' }} />
                        <button type="button" className="um-pw-toggle" onClick={() => setShowResetPw({ ...showResetPw, confirm: !showResetPw.confirm })}>
                          <i className={`fas ${showResetPw.confirm ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                        </button>
                      </div>
                    </div>
                    {resetPwForm.newPassword && resetPwForm.confirmPassword && resetPwForm.newPassword !== resetPwForm.confirmPassword && (
                      <p className="um-pw-mismatch"><i className="fas fa-exclamation-circle"></i> Passwords do not match</p>
                    )}
                  </div>
                  <div className="um-reset-footer">
                    <button className="btn-secondary" onClick={() => { setShowResetPwModal(null); setResetPwForm({ newPassword: '', confirmPassword: '' }); }}>Cancel</button>
                    <button className="btn-primary" onClick={() => handleAdminResetPassword(showResetPwModal.id)} disabled={!resetPwForm.newPassword || resetPwForm.newPassword.length < 8 || resetPwForm.newPassword !== resetPwForm.confirmPassword}>
                      <i className="fas fa-save"></i> Save Password
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ========== MINISTRY MANAGEMENT (Admin/Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'ministry-management' ? 'active' : ''}`}>
            <h2 className="section-title">Ministry Management</h2>

            {featureOn('ministry.create') && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => setShowMinistryForm(true)}>
                <i className="fas fa-plus"></i> Create Ministry
              </button>
            )}

            {showMinistryForm && (
              <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>New Ministry</h3>
                <div className="form-group"><label>Name *</label><input className="form-control" style={{ padding: '10px 15px' }} value={ministryForm.name} onChange={(e) => setMinistryForm({ ...ministryForm, name: e.target.value })} /></div>
                <div className="form-group"><label>Description</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={3} value={ministryForm.description} onChange={(e) => setMinistryForm({ ...ministryForm, description: e.target.value })} /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleMinistrySubmit}><i className="fas fa-save"></i> Create</button>
                  <button className="btn-secondary" onClick={() => setShowMinistryForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {ministriesList.map((min) => (
              <div key={min.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ color: 'var(--primary)' }}>{min.name}</h3>
                  {min.description && <p style={{ color: '#6c757d', margin: '4px 0' }}>{min.description}</p>}
                  {min.leader_name && <small><i className="fas fa-user-tie"></i> {min.leader_name}</small>}
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  <span style={{ padding: '4px 12px', borderRadius: 12, fontSize: '0.75rem', background: min.is_active ? 'rgba(40,167,69,0.2)' : 'rgba(220,53,69,0.2)', color: min.is_active ? '#28a745' : '#dc3545' }}>{min.is_active !== false ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            ))}
          </section>

          {/* ========== ROLES & PERMISSIONS (Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'roles-permissions' ? 'active' : ''}`}>
            <h2 className="section-title">Roles &amp; Permissions</h2>
            {rolesList.map((role) => (
              <div key={role.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12 }}>
                <h3 style={{ color: 'var(--primary)' }}>{role.name}</h3>
                <p style={{ color: '#6c757d' }}>{role.description}</p>
                <div style={{ marginTop: 8 }}>
                  <small style={{ color: '#adb5bd' }}>Permissions: {typeof role.permissions === 'string' ? JSON.parse(role.permissions).length : (role.permissions?.length || 0)}</small>
                </div>
              </div>
            ))}
            {rolesList.length === 0 && <p style={{ color: '#6c757d' }}>Loading roles...</p>}
          </section>

          {/* ========== PERMISSIONS CONTROL (Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'permissions-control' ? 'active' : ''}`}>
            <h2 className="section-title">Permissions Control</h2>

            {/* ---- Password Gate ---- */}
            {!permCtrlUnlocked ? (
              <div className="perm-gate">
                <div className="perm-gate-card">
                  <div className="perm-gate-icon">
                    <i className="fas fa-lock"></i>
                  </div>
                  <h3 className="perm-gate-title">Restricted Access</h3>
                  <p className="perm-gate-desc">Enter your admin access password to manage permissions. This protects role permissions from unauthorized changes.</p>
                  {!hasAdminAccessPassword && (
                    <div className="perm-gate-warning">
                      <i className="fas fa-exclamation-triangle"></i>
                      <span>No access password set. Go to <strong>My Profile → Security</strong> tab to set one first.</span>
                    </div>
                  )}
                  {hasAdminAccessPassword && (
                    <>
                      <div className="perm-gate-input-wrap">
                        <input
                          type="password"
                          className="perm-gate-input"
                          placeholder="Enter access password"
                          value={permCtrlPasswordInput}
                          onChange={(e) => { setPermCtrlPasswordInput(e.target.value); setPermCtrlPasswordError(''); }}
                          onKeyDown={(e) => e.key === 'Enter' && verifyPermCtrlPassword()}
                        />
                        <button className="perm-gate-btn" onClick={verifyPermCtrlPassword} disabled={permCtrlVerifying}>
                          {permCtrlVerifying ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-arrow-right"></i>}
                        </button>
                      </div>
                      {permCtrlPasswordError && (
                        <div className="perm-gate-error">
                          <i className="fas fa-exclamation-circle"></i> {permCtrlPasswordError}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* ---- Unlocked: Permission Control Panel ---- */}
                <div className="perm-ctrl-header">
                  <div className="perm-ctrl-header-left">
                    <p className="perm-ctrl-subtitle">
                      <i className="fas fa-info-circle"></i>
                      Enable or disable features for each role. Changes take effect <strong>in real-time</strong>.
                    </p>
                  </div>
                  <button className="perm-ctrl-lock-btn" onClick={() => { setPermCtrlUnlocked(false); setPermCtrlPasswordInput(''); }} title="Lock permissions">
                    <i className="fas fa-lock"></i> Lock
                  </button>
                </div>

                {/* Role Selector Dropdown */}
                <div className="perm-ctrl-role-bar">
                  <label className="perm-ctrl-role-label"><i className="fas fa-users-cog"></i> Role:</label>
                  <select
                    className="perm-ctrl-role-select"
                    value={permCtrlRole}
                    onChange={(e) => setPermCtrlRole(e.target.value)}
                  >
                    {['Guest', 'Member', 'Song Leader', 'Leader', 'Pastor', 'Admin'].map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <div className="perm-ctrl-actions-group">
                    <button
                      className="perm-ctrl-action-btn perm-ctrl-action-enable"
                      onClick={() => setPermCtrlConfirmModal({
                        action: 'enable-all',
                        title: 'Enable All Features',
                        message: `Are you sure you want to enable ALL features for "${permCtrlRole}"? This will grant full access to every feature.`,
                        onConfirm: () => { bulkToggleRole(permCtrlRole, true); setPermCtrlConfirmModal(null); },
                      })}
                      disabled={permCtrlLoading}
                    >
                      <i className="fas fa-check-double"></i> <span>Enable All</span>
                    </button>
                    <button
                      className="perm-ctrl-action-btn perm-ctrl-action-disable"
                      onClick={() => setPermCtrlConfirmModal({
                        action: 'disable-all',
                        title: 'Disable All Features',
                        message: `Are you sure you want to disable ALL features for "${permCtrlRole}"? Users with this role will lose access to every feature.`,
                        onConfirm: () => { bulkToggleRole(permCtrlRole, false); setPermCtrlConfirmModal(null); },
                      })}
                      disabled={permCtrlLoading}
                    >
                      <i className="fas fa-times-circle"></i> <span>Disable All</span>
                    </button>
                    <button
                      className="perm-ctrl-action-btn perm-ctrl-action-reset"
                      onClick={() => setPermCtrlConfirmModal({
                        action: 'reset',
                        title: 'Reset to Defaults',
                        message: `Are you sure you want to reset ALL permission overrides for "${permCtrlRole}"? This restores every feature to its default state.`,
                        onConfirm: () => { resetRolePermissions(permCtrlRole); setPermCtrlConfirmModal(null); },
                      })}
                    >
                      <i className="fas fa-undo"></i> <span>Reset</span>
                    </button>
                  </div>
                </div>

                {/* Search */}
                <div className="perm-ctrl-search-bar">
                  <i className="fas fa-search"></i>
                  <input
                    type="text"
                    placeholder="Search features..."
                    value={permCtrlSearch}
                    onChange={(e) => setPermCtrlSearch(e.target.value)}
                  />
                  {permCtrlSearch && (
                    <button className="perm-ctrl-search-clear" onClick={() => setPermCtrlSearch('')}><i className="fas fa-times"></i></button>
                  )}
                </div>

                {/* Category Accordion Groups */}
                <div className="perm-ctrl-categories">
                  {(() => {
                    const grouped = getFeaturesByCategory();
                    const allCats = Object.keys(grouped);
                    const searchLower = permCtrlSearch.toLowerCase();
                    let anyResults = false;

                    return (
                      <>
                        {allCats.map((cat) => {
                          let features = grouped[cat] || [];
                          if (searchLower) {
                            features = features.filter((f) =>
                              f.label.toLowerCase().includes(searchLower) ||
                              f.description.toLowerCase().includes(searchLower) ||
                              f.key.toLowerCase().includes(searchLower)
                            );
                          }
                          if (features.length === 0) return null;
                          anyResults = true;

                          const enabledCount = features.filter((f) => {
                            const ok = `${permCtrlRole}::${f.key}`;
                            return ok in permissionOverrides ? permissionOverrides[ok] : true;
                          }).length;

                          const isExpanded = permCtrlExpandedCats[cat] !== false; // default open

                          return (
                            <div key={cat} className="perm-ctrl-cat-group">
                              <button className="perm-ctrl-cat-header" onClick={() => togglePermCtrlCategory(cat)}>
                                <div className="perm-ctrl-cat-header-left">
                                  <i className={`fas fa-chevron-${isExpanded ? 'down' : 'right'} perm-ctrl-cat-arrow`}></i>
                                  <span className="perm-ctrl-cat-name">{cat}</span>
                                  <span className="perm-ctrl-cat-count">{enabledCount}/{features.length}</span>
                                </div>
                                <div className="perm-ctrl-cat-bar">
                                  <div className="perm-ctrl-cat-bar-fill" style={{ width: `${(enabledCount / features.length) * 100}%` }}></div>
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="perm-ctrl-cat-body">
                                  {features.map((feat) => {
                                    const overrideKey = `${permCtrlRole}::${feat.key}`;
                                    const currentEnabled = overrideKey in permissionOverrides ? permissionOverrides[overrideKey] : true;
                                    const isSaving = permCtrlSaving[overrideKey];

                                    return (
                                      <div key={feat.key} className={`perm-ctrl-feat-row ${currentEnabled ? 'enabled' : 'disabled'} ${isSaving ? 'saving' : ''}`}>
                                        <div className={`perm-ctrl-feat-icon ${currentEnabled ? 'on' : 'off'}`}>
                                          <i className={feat.icon}></i>
                                        </div>
                                        <div className="perm-ctrl-feat-info">
                                          <div className="perm-ctrl-feat-label">{feat.label}</div>
                                          <div className="perm-ctrl-feat-desc">{feat.description}</div>
                                        </div>
                                        <button
                                          className={`perm-ctrl-toggle ${currentEnabled ? 'on' : 'off'}`}
                                          onClick={() => {
                                            if (isSaving) return;
                                            toggleFeaturePermission(permCtrlRole, feat.key, currentEnabled);
                                          }}
                                          disabled={isSaving}
                                          title={currentEnabled ? 'Click to disable' : 'Click to enable'}
                                        >
                                          <span className="perm-ctrl-toggle-knob"></span>
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!anyResults && (
                          <div className="perm-ctrl-empty">
                            <i className="fas fa-search"></i>
                            <p>No features found matching &ldquo;{permCtrlSearch}&rdquo;</p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Live Indicator */}
                <div className="perm-ctrl-live-indicator">
                  <span className="perm-ctrl-live-dot"></span>
                  <span>Real-time sync active — Changes reflect instantly for all users</span>
                </div>

                {/* Confirmation Modal */}
                {permCtrlConfirmModal && (
                  <div className="perm-ctrl-confirm-overlay" onClick={() => setPermCtrlConfirmModal(null)}>
                    <div className="perm-ctrl-confirm-modal" onClick={(e) => e.stopPropagation()}>
                      <div className={`perm-ctrl-confirm-icon ${permCtrlConfirmModal.action}`}>
                        <i className={`fas fa-${permCtrlConfirmModal.action === 'enable-all' ? 'check-double' : permCtrlConfirmModal.action === 'disable-all' ? 'times-circle' : 'undo'}`}></i>
                      </div>
                      <h3 className="perm-ctrl-confirm-title">{permCtrlConfirmModal.title}</h3>
                      <p className="perm-ctrl-confirm-msg">{permCtrlConfirmModal.message}</p>
                      <div className="perm-ctrl-confirm-actions">
                        <button className="perm-ctrl-confirm-cancel" onClick={() => setPermCtrlConfirmModal(null)}>Cancel</button>
                        <button className={`perm-ctrl-confirm-ok ${permCtrlConfirmModal.action}`} onClick={permCtrlConfirmModal.onConfirm}>
                          {permCtrlConfirmModal.action === 'enable-all' ? 'Enable All' : permCtrlConfirmModal.action === 'disable-all' ? 'Disable All' : 'Reset'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* ========== SYSTEM CONFIG (Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'system-config' ? 'active' : ''}`}>
            <h2 className="section-title">System Configuration</h2>
            {Object.entries(systemSettings).map(([key, value]) => (
              <div key={key} style={{ padding: 15, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ textTransform: 'capitalize' }}>{key.replace(/_/g, ' ')}</strong>
                  <p style={{ color: '#6c757d', fontSize: '0.85rem', margin: 0 }}>{JSON.stringify(value)}</p>
                </div>
              </div>
            ))}
            {Object.keys(systemSettings).length === 0 && <p style={{ color: '#6c757d' }}>Loading settings...</p>}
          </section>

          {/* ========== TERMS & CONDITIONS EDITOR (Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'terms-conditions' ? 'active' : ''}`}>
            <h2 className="section-title"><i className="fas fa-file-contract" style={{ marginRight: 10, color: 'var(--accent)' }}></i>Terms & Conditions Editor</h2>

            <div className="terms-editor-container">
              {/* Toolbar */}
              <div className="terms-editor-toolbar">
                <div className="terms-editor-toolbar-group">
                  <button type="button" title="Bold" onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }}>
                    <i className="fas fa-bold"></i>
                  </button>
                  <button type="button" title="Italic" onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); }}>
                    <i className="fas fa-italic"></i>
                  </button>
                  <button type="button" title="Underline" onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline'); }}>
                    <i className="fas fa-underline"></i>
                  </button>
                  <button type="button" title="Strikethrough" onMouseDown={(e) => { e.preventDefault(); document.execCommand('strikeThrough'); }}>
                    <i className="fas fa-strikethrough"></i>
                  </button>
                </div>
                <div className="terms-editor-toolbar-divider"></div>
                <div className="terms-editor-toolbar-group">
                  <button type="button" title="Heading 2" onMouseDown={(e) => { e.preventDefault(); document.execCommand('formatBlock', false, 'h2'); }}>
                    H2
                  </button>
                  <button type="button" title="Heading 3" onMouseDown={(e) => { e.preventDefault(); document.execCommand('formatBlock', false, 'h3'); }}>
                    H3
                  </button>
                  <button type="button" title="Paragraph" onMouseDown={(e) => { e.preventDefault(); document.execCommand('formatBlock', false, 'p'); }}>
                    P
                  </button>
                </div>
                <div className="terms-editor-toolbar-divider"></div>
                <div className="terms-editor-toolbar-group">
                  <button type="button" title="Bulleted List" onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertUnorderedList'); }}>
                    <i className="fas fa-list-ul"></i>
                  </button>
                  <button type="button" title="Numbered List" onMouseDown={(e) => { e.preventDefault(); document.execCommand('insertOrderedList'); }}>
                    <i className="fas fa-list-ol"></i>
                  </button>
                </div>
                <div className="terms-editor-toolbar-divider"></div>
                <div className="terms-editor-toolbar-group">
                  <button type="button" title="Align Left" onMouseDown={(e) => { e.preventDefault(); document.execCommand('justifyLeft'); }}>
                    <i className="fas fa-align-left"></i>
                  </button>
                  <button type="button" title="Align Center" onMouseDown={(e) => { e.preventDefault(); document.execCommand('justifyCenter'); }}>
                    <i className="fas fa-align-center"></i>
                  </button>
                  <button type="button" title="Align Right" onMouseDown={(e) => { e.preventDefault(); document.execCommand('justifyRight'); }}>
                    <i className="fas fa-align-right"></i>
                  </button>
                </div>
                <div className="terms-editor-toolbar-divider"></div>
                <div className="terms-editor-toolbar-group">
                  <button type="button" title="Undo" onMouseDown={(e) => { e.preventDefault(); document.execCommand('undo'); }}>
                    <i className="fas fa-undo"></i>
                  </button>
                  <button type="button" title="Redo" onMouseDown={(e) => { e.preventDefault(); document.execCommand('redo'); }}>
                    <i className="fas fa-redo"></i>
                  </button>
                </div>
              </div>

              {/* Editable Area */}
              {termsLoading ? (
                <div className="terms-editor-loading">
                  <i className="fas fa-spinner fa-spin"></i> Loading content...
                </div>
              ) : (
                <div
                  className="terms-editor-area"
                  contentEditable
                  suppressContentEditableWarning
                  dangerouslySetInnerHTML={{ __html: termsContent }}
                  onInput={(e) => setTermsContent(e.currentTarget.innerHTML)}
                  style={{ minHeight: 400 }}
                />
              )}

              {/* Footer actions */}
              <div className="terms-editor-footer">
                <div className="terms-editor-meta">
                  {termsLastUpdated && (
                    <span><i className="fas fa-clock"></i> Last updated: {new Date(termsLastUpdated).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                </div>
                <div className="terms-editor-actions">
                  <a href="/terms" target="_blank" className="terms-editor-preview-btn">
                    <i className="fas fa-external-link-alt"></i> Preview Page
                  </a>
                  <button className="terms-editor-save-btn" onClick={saveTermsConditions} disabled={termsSaving}>
                    {termsSaving ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : <><i className="fas fa-save"></i> Save Changes</>}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ========== AUDIT LOGS (Super Admin) ========== */}
          <section className={`content-section ${activeSection === 'audit-logs' ? 'active' : ''}`}>
            <h2 className="section-title">Audit Logs</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: 'var(--primary)', color: 'white' }}>
                    <th style={{ padding: 8 }}>Time</th>
                    <th style={{ padding: 8 }}>User</th>
                    <th style={{ padding: 8 }}>Action</th>
                    <th style={{ padding: 8 }}>Resource</th>
                    <th style={{ padding: 8 }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: 8 }}>{formatDateTime(log.created_at)}</td>
                      <td style={{ padding: 8 }}>{log.user_name || 'System'}</td>
                      <td style={{ padding: 8 }}>{log.action}</td>
                      <td style={{ padding: 8 }}>{log.resource}</td>
                      <td style={{ padding: 8 }}>{JSON.stringify(log.details || {})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {auditLogs.length === 0 && <p style={{ color: '#6c757d', marginTop: 15 }}>No audit logs found.</p>}
          </section>

          {/* ========== BIBLE READER ========== */}
          <section className={`content-section ${activeSection === 'bible-reader' ? 'active' : ''}`}>
            <h2 className="section-title">Bible Reader</h2>

            {/* Search + Translation Row */}
            <div className="bible-search-translation-row">
              <div className="bible-direct-input">
                <div className="bible-direct-icon"><i className="fas fa-search"></i></div>
                <input
                  className="form-control"
                  placeholder='e.g. "John 3:16" or "Ephesians 6:1"'
                  value={directScripture}
                  onChange={(e) => setDirectScripture(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadDirectScripture()}
                />
                <button className="btn-primary" onClick={loadDirectScripture}><i className="fas fa-arrow-right"></i> Go</button>
              </div>
              <div className="bible-version-bar">
                <label><i className="fas fa-globe"></i> Translation:</label>
                <select
                  className="bible-version-select"
                  value={bibleVersion}
                  onChange={(e) => {
                    setBibleVersion(e.target.value);
                    localStorage.setItem('bibleVersionPref', e.target.value);
                  }}
                >
                  {BIBLE_VERSIONS.map((v) => (
                    <option key={v.value} value={v.value}>{v.label} — {v.fullName}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bible-divider"><span>or browse by book</span></div>

            {/* Book / Chapter / Verse Dropdowns */}
            <div className="bible-controls">
              <div className="form-group" style={{ flex: 2 }}><label>Book</label>
                <select className="form-select" value={bibleBook} onChange={(e) => { setBibleBook(e.target.value); setBibleChapter(1); setBibleVerse(''); }} style={{ padding: '10px' }}>
                  {Object.keys(BIBLE_BOOKS).map((b) => (<option key={b} value={b}>{b}</option>))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}><label>Chapter</label>
                <select className="form-select" value={bibleChapter} onChange={(e) => { setBibleChapter(parseInt(e.target.value)); setBibleVerse(''); }} style={{ padding: '10px' }}>
                  {Array.from({ length: BIBLE_BOOKS[bibleBook] || 1 }, (_, i) => i + 1).map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}><label>Verse <span style={{ fontSize: '0.75rem', color: '#999' }}>(optional)</span></label>
                <select className="form-select" value={bibleVerse} onChange={(e) => setBibleVerse(e.target.value)} style={{ padding: '10px' }}>
                  <option value="">All</option>
                  {Array.from({ length: getVerseCount(bibleBook, bibleChapter) }, (_, i) => i + 1).map((v) => (<option key={v} value={v}>{v}</option>))}
                </select>
              </div>
              <button className="btn-primary bible-read-btn" onClick={() => loadBibleChapter()} style={{ padding: '10px 24px' }}><i className="fas fa-book-open"></i> Read</button>
            </div>

            {/* Bible Text Display */}
            {bibleText && <div className="bible-text-display" ref={bibleTextRef} style={{ position: 'relative' }}><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>{bibleText}</pre>
              {highlightPopup.visible && (
                <button className="highlight-ask-btn" onMouseDown={(e) => e.preventDefault()} onClick={askHighlightedText} style={{ position: 'absolute', left: highlightPopup.x, top: highlightPopup.y, transform: 'translate(-50%, -100%)' }}>
                  <i className="fas fa-question-circle"></i> Ask about this
                </button>
              )}
            </div>}

            {/* Ask about this passage */}
            {bibleText && (
              <div className="bible-qa" style={{ marginTop: 20 }}>
                <h3><i className="fas fa-comment-dots"></i> Ask about this passage</h3>
                <div style={{ display: 'flex', gap: 10 }}>
                  <input className="form-control" placeholder="Ask a question about this scripture..." value={bibleQuestion} onChange={(e) => setBibleQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askBibleQuestionHandler()} style={{ padding: '10px 15px' }} />
                  <button className="btn-primary" onClick={askBibleQuestionHandler}><i className="fas fa-paper-plane"></i> Ask</button>
                </div>
                {bibleAnswer && bibleAnswer !== 'Thinking...' && (
                  <div className="bible-answer-card" style={{ marginTop: 15 }}>
                    <div className="bible-answer-header">
                      <span><i className="fas fa-lightbulb"></i> AI Explanation</span>
                      <button className="bible-copy-btn" onClick={copyBibleAnswer}>
                        <i className={answerCopied ? 'fas fa-check' : 'fas fa-copy'}></i> {answerCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <div className="bible-answer-body">{renderMarkdown(bibleAnswer)}</div>
                  </div>
                )}
                {bibleAnswer === 'Thinking...' && (
                  <div className="bible-thinking" style={{ marginTop: 15 }}>
                    <div className="bible-thinking-dots"><span></span><span></span><span></span></div>
                    <span>Analyzing scripture...</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ========== DAILY QUOTE ========== */}
          <section className={`content-section ${activeSection === 'daily-quote' ? 'active' : ''}`}>
            <h2 className="section-title">Daily Quote</h2>
            <div className="quote-container"><div className="quote-text">&ldquo;{dailyQuote.quote}&rdquo;</div><div className="quote-author">— {dailyQuote.author}</div></div>
          </section>

          {/* ========== SPIRITUAL ASSISTANT ========== */}
          <section className={`content-section ${activeSection === 'spiritual-assistant' ? 'active' : ''}`}>
            <h2 className="section-title">Spiritual AI Assistant</h2>

            {/* Disclaimer Banner */}
            <div className="ai-disclaimer">
              <div className="ai-disclaimer-icon"><i className="fas fa-exclamation-triangle"></i></div>
              <div className="ai-disclaimer-text">
                <strong>Important Reminder:</strong> It is important to have a personal communication between you and God to receive true wisdom. Read His Word, pray always, and seek the Holy Spirit&apos;s guidance. <em>I am just your AI Assistant</em> — not a replacement for your relationship with God.
                <div className="ai-disclaimer-verse">&ldquo;If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.&rdquo; — <strong>James 1:5</strong></div>
              </div>
            </div>

            <div className="chat-container">
              <div className="chat-header">
                <span><i className="fas fa-cross"></i> Spiritual AI Assistant</span>
                <button className="chat-clear-btn" onClick={clearChatMemory} title="Clear chat history">
                  <i className="fas fa-trash-alt"></i> Clear History
                </button>
              </div>
              <div className="chat-messages">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`chat-message ${msg.role === 'user' ? 'user-message' : 'assistant-message'}`}>
                    <div className="message-content">
                      {msg.role === 'assistant' && <div className="message-avatar"><i className="fas fa-cross"></i></div>}
                      <div className="message-text"><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{msg.content}</pre></div>
                    </div>
                  </div>
                ))}
                {chatLoading && <div className="chat-message assistant-message"><div className="message-content"><div className="message-avatar"><i className="fas fa-cross"></i></div><div className="typing-indicator"><span></span><span></span><span></span></div></div></div>}
                <div ref={chatEndRef}></div>
              </div>
              <div className="chat-input-container">
                <textarea className="chat-input" placeholder="Ask a spiritual question..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }} rows={1}></textarea>
                <button className="chat-send-btn" onClick={sendChatMessage} disabled={chatLoading}><i className="fas fa-paper-plane"></i></button>
              </div>
            </div>
          </section>

          {/* ========== MY PROFILE ========== */}
          <section className={`content-section ${activeSection === 'my-profile' ? 'active' : ''}`}>
            <h2 className="section-title">My Profile</h2>

            {/* Profile Picture Crop Modal */}
            {showCropModal && cropImage && (
              <div className={`profile-crop-modal-overlay ${closingCropModal ? 'closing' : ''}`} onClick={closeCropModal}>
                <div className={`profile-crop-modal ${closingCropModal ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
                  <div className="profile-crop-modal-header">
                    <h3><i className="fas fa-crop-alt"></i> Crop Your Photo</h3>
                    <button className="btn-close-modal" onClick={closeCropModal}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="profile-crop-container">
                    <Cropper
                      image={cropImage}
                      crop={crop}
                      zoom={zoom}
                      aspect={1}
                      cropShape="round"
                      showGrid={false}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={(_, croppedPixels) => setCroppedAreaPixels(croppedPixels)}
                    />
                  </div>
                  <div className="profile-crop-controls">
                    <div className="profile-crop-zoom">
                      <i className="fas fa-search-minus"></i>
                      <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="profile-crop-slider" />
                      <i className="fas fa-search-plus"></i>
                    </div>
                    <div className="profile-crop-actions">
                      <button className="btn-secondary" onClick={closeCropModal}>Cancel</button>
                      <button className="btn-primary" onClick={handleCropComplete} disabled={uploadingPic}>
                        {uploadingPic ? <><i className="fas fa-spinner fa-spin"></i> Uploading...</> : <><i className="fas fa-check"></i> Save Photo</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* View Profile Picture Lightbox */}
            {viewProfilePic && userData.profile_picture && (
              <div className="profile-pic-lightbox" onClick={() => setViewProfilePic(false)}>
                <div className="profile-pic-lightbox-content" onClick={(e) => e.stopPropagation()}>
                  <button className="profile-pic-lightbox-close" onClick={() => setViewProfilePic(false)}><i className="fas fa-times"></i></button>
                  <img src={userData.profile_picture} alt="Profile" referrerPolicy="no-referrer" />
                  <p className="profile-pic-lightbox-name">{userData.firstname} {userData.lastname}</p>
                </div>
              </div>
            )}

            {/* Profile Header Card - LinkedIn Modern */}
            <div className="profile-card-v3">
              <div className="profile-banner-v3">
                {/* Life Verse on Banner */}
                {userData.life_verse && (
                  <div className="profile-banner-verse">
                    {lifeVerseLoading ? (
                      <div className="profile-banner-verse-loading">
                        <i className="fas fa-spinner fa-spin"></i>
                      </div>
                    ) : (
                      <>
                        <i className="fas fa-quote-left profile-banner-verse-quote"></i>
                        <p className="profile-banner-verse-text">
                          {lifeVerseFullText || userData.life_verse}
                        </p>
                        {lifeVerseRef && (
                          <span className="profile-banner-verse-ref">— {lifeVerseRef}</span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="profile-abstract-decor" aria-hidden="true"></div>
              <div className="profile-avatar-section-v3">
                <div className="profile-avatar-wrapper-v3" ref={avatarWrapperRef}>
                  <div className="profile-avatar-v3" onClick={() => setShowAvatarMenu(!showAvatarMenu)} title="Profile photo options">
                    {userData.profile_picture ? (
                      <img src={userData.profile_picture} alt="Profile" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="profile-avatar-initials-v3">{initials}</span>
                    )}
                    <div className="profile-avatar-overlay-v3">
                      <i className="fas fa-camera"></i>
                    </div>
                  </div>
                  <div className={`profile-avatar-badge-v3 ${isVerified ? 'verified' : 'unverified'}`}>
                    <i className={`fas fa-${isVerified ? 'check' : 'clock'}`}></i>
                  </div>
                  {showAvatarMenu && (
                    <div className="profile-avatar-menu" ref={avatarMenuRef} onClick={(e) => e.stopPropagation()}>
                      {userData.profile_picture && (
                        <button className="profile-avatar-menu-item" onClick={() => { setViewProfilePic(true); setShowAvatarMenu(false); }}>
                          <i className="fas fa-eye"></i> View Photo
                        </button>
                      )}
                      {featureOn('profile.upload_picture') && (
                        <button className="profile-avatar-menu-item" onClick={() => { profilePicInputRef.current?.click(); setShowAvatarMenu(false); }}>
                          <i className="fas fa-upload"></i> Upload Photo
                        </button>
                      )}
                    </div>
                  )}
                  <input ref={profilePicInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handleProfilePicSelect} />
                </div>
              </div>
              <div className="profile-details-v3">
                <div className="profile-name-row-v3">
                  <h2 className="profile-name-v3">{userData.firstname} {userData.lastname}</h2>
                  <span className={`profile-verified-pill-v3 ${isVerified ? 'verified' : 'unverified'}`}>
                    <i className={`fas fa-${isVerified ? 'check-circle' : 'clock'}`}></i> {isVerified ? 'Verified' : 'Pending'}
                  </span>
                </div>
                <div className="profile-meta-row-v3">
                  <span className="profile-role-chip-v3"><i className="fas fa-shield-alt"></i> {userRole}</span>
                  {userData.ministry && <span className="profile-ministry-chip-v3"><i className="fas fa-church"></i> {userData.ministry}</span>}
                </div>
              </div>
            </div>

            <div className="profile-tabs">
              <button className={`profile-tab ${profileTab === 'personal' ? 'active' : ''}`} onClick={() => setProfileTab('personal')}><i className="fas fa-user"></i> Personal Info</button>
              <button className={`profile-tab ${profileTab === 'password' ? 'active' : ''}`} onClick={() => setProfileTab('password')}><i className="fas fa-lock"></i> Change Password</button>
              {(userRole === 'Admin' || userRole === 'Super Admin') && (
                <button className={`profile-tab ${profileTab === 'security' ? 'active' : ''}`} onClick={() => setProfileTab('security')}><i className="fas fa-shield-alt"></i> Security</button>
              )}
              <button className={`profile-tab ${profileTab === 'preferences' ? 'active' : ''}`} onClick={() => setProfileTab('preferences')}><i className="fas fa-cog"></i> Preferences</button>
            </div>

            {profileTab === 'personal' && (
              <div className="profile-form profile-form-v2">
                <div className="profile-form-section-title"><i className="fas fa-edit"></i> Editable Information</div>
                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  <div className="form-group profile-field-editable">
                    <label>First Name</label>
                    <input className="form-control" style={{ padding: '12px 16px' }} value={profileForm.firstname} onChange={(e) => setProfileForm({ ...profileForm, firstname: e.target.value })} />
                  </div>
                  <div className="form-group profile-field-editable">
                    <label>Last Name</label>
                    <input className="form-control" style={{ padding: '12px 16px' }} value={profileForm.lastname} onChange={(e) => setProfileForm({ ...profileForm, lastname: e.target.value })} />
                  </div>
                </div>
                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  <div className="form-group profile-field-editable">
                    <label><i className="fas fa-birthday-cake" style={{ marginRight: 6, color: 'var(--primary)' }}></i>Birthdate</label>
                    <input type="date" className="form-control" style={{ padding: '12px 16px' }} value={profileForm.birthdate || ''} onChange={(e) => setProfileForm({ ...profileForm, birthdate: e.target.value })} />
                  </div>
                  <div className="form-group profile-field-editable">
                    <label><i className="fas fa-bible" style={{ marginRight: 6, color: 'var(--primary)' }}></i>Life Verse</label>
                    <div className="life-verse-input-row">
                    <select
                      className="life-verse-version-select"
                      value={lifeVerseVersion}
                      onChange={(e) => {
                        setLifeVerseVersion(e.target.value);
                        localStorage.setItem('lifeVerseVersionPref', e.target.value);
                        if (profileForm.life_verse) {
                          // Clear cache and re-fetch with new version
                          setLifeVerseFullText('');
                          fetchLifeVerse(profileForm.life_verse, e.target.value);
                        }
                      }}
                    >
                      {BIBLE_VERSIONS.map((v) => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                      ))}
                    </select>
                    <input className="form-control" style={{ padding: '12px 16px', flex: 1 }} placeholder='e.g. Ephesians 6:1 or Jeremiah 29:11 - For I know the plans...' value={profileForm.life_verse || ''} onChange={(e) => setProfileForm({ ...profileForm, life_verse: e.target.value })} />
                  </div>
                    <small style={{ color: '#6c757d', fontSize: '0.78rem', marginTop: 4, display: 'block' }}>Enter a reference like &quot;Ephesians 6:1&quot; or include the text with &quot;Jeremiah 29:11 - For I know the plans...&quot;</small>
                  </div>
                </div>

                <div className="profile-form-section-title" style={{ marginTop: 28 }}><i className="fas fa-lock"></i> Account Information <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#999' }}>(Read only)</span></div>
                <div className="form-group profile-field-readonly">
                  <label>Email Address</label>
                  <input className="form-control profile-input-disabled" style={{ padding: '12px 16px' }} value={userData.email || ''} readOnly />
                </div>
                {userRole !== 'Guest' && (
                  <>
                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                      <div className="form-group profile-field-readonly">
                        <label>Ministry</label>
                        <input className="form-control profile-input-disabled" style={{ padding: '12px 16px' }} value={userData.ministry || 'Not Assigned'} readOnly />
                      </div>
                      <div className="form-group profile-field-readonly">
                        <label>Role</label>
                        <input className="form-control profile-input-disabled" style={{ padding: '12px 16px' }} value={userRole} readOnly />
                      </div>
                    </div>
                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                      <div className="form-group profile-field-readonly">
                        <label>Status</label>
                        <input className="form-control profile-input-disabled" style={{ padding: '12px 16px' }} value={userData.status || ''} readOnly />
                      </div>
                      <div className="form-group profile-field-readonly">
                        <label>Member ID</label>
                        <input className="form-control profile-input-disabled" style={{ padding: '12px 16px' }} value={userData.memberId || 'N/A'} readOnly />
                      </div>
                    </div>
                  </>
                )}
                {featureOn('profile.update') && (
                  <button className="btn-primary profile-save-btn" onClick={saveProfile} disabled={profileLoading}>{profileLoading ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : <><i className="fas fa-save"></i> Save Changes</>}</button>
                )}
              </div>
            )}

            {profileTab === 'password' && (
              <div className="profile-form profile-form-v2">
                {userData.isGoogleUser && !hasLocalPassword ? (
                  <>
                    <div className="profile-password-notice profile-password-notice-warning">
                      <i className="fas fa-info-circle"></i>
                      <p>You signed up with Google. Set a password below so you can also log in manually with your email and password.</p>
                    </div>
                    <div className="form-group">
                      <label>New Password</label>
                      <div className="password-input-wrapper">
                        <input type={showSetNewPassword ? 'text' : 'password'} className="form-control" style={{ padding: '12px 16px', paddingRight: 45 }} placeholder="At least 8 characters" value={setPasswordFormData.newPassword} onChange={(e) => setSetPasswordFormData({ ...setPasswordFormData, newPassword: e.target.value })} />
                        <button type="button" className="password-eye-btn" onClick={() => setShowSetNewPassword(!showSetNewPassword)} tabIndex={-1}>
                          <i className={`fas fa-eye${showSetNewPassword ? '-slash' : ''}`}></i>
                        </button>
                      </div>
                      {setPasswordFormData.newPassword && (() => { const s = getPasswordStrength(setPasswordFormData.newPassword); return (
                        <div className="password-strength-bar-container">
                          <div className="password-strength-bar">
                            {[1,2,3,4,5].map(i => (<div key={i} className="password-strength-segment" style={{ background: i <= s.score ? s.color : '#e0e0e0' }}></div>))}
                          </div>
                          <span className="password-strength-label" style={{ color: s.color }}>{s.label}</span>
                        </div>
                      ); })()}
                    </div>
                    <div className="form-group">
                      <label>Confirm Password</label>
                      <div className="password-input-wrapper">
                        <input type={showSetConfirmPassword ? 'text' : 'password'} className="form-control" style={{ padding: '12px 16px', paddingRight: 45 }} placeholder="Confirm your password" value={setPasswordFormData.confirmPassword} onChange={(e) => setSetPasswordFormData({ ...setPasswordFormData, confirmPassword: e.target.value })} />
                        <button type="button" className="password-eye-btn" onClick={() => setShowSetConfirmPassword(!showSetConfirmPassword)} tabIndex={-1}>
                          <i className={`fas fa-eye${showSetConfirmPassword ? '-slash' : ''}`}></i>
                        </button>
                      </div>
                    </div>
                    {setPasswordFormData.confirmPassword && setPasswordFormData.newPassword !== setPasswordFormData.confirmPassword && <p className="password-mismatch-msg"><i className="fas fa-exclamation-circle"></i> Passwords do not match</p>}
                    <button className="btn-primary profile-save-btn" onClick={handleSetPassword} disabled={profileLoading}>{profileLoading ? <><i className="fas fa-spinner fa-spin"></i> Setting Password...</> : <><i className="fas fa-key"></i> Set Password</>}</button>
                  </>
                ) : (
                  <>
                    {userData.isGoogleUser && hasLocalPassword && (
                      <div className="profile-password-notice profile-password-notice-success">
                        <i className="fas fa-check-circle"></i>
                        <p>Password set! You can now log in with your email and password, or continue using Google.</p>
                      </div>
                    )}
                    <div className="form-group">
                      <label>Current Password</label>
                      <div className="password-input-wrapper">
                        <input type={showCurrentPassword ? 'text' : 'password'} className="form-control" style={{ padding: '12px 16px', paddingRight: 45 }} placeholder="Enter current password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} />
                        <button type="button" className="password-eye-btn" onClick={() => setShowCurrentPassword(!showCurrentPassword)} tabIndex={-1}>
                          <i className={`fas fa-eye${showCurrentPassword ? '-slash' : ''}`}></i>
                        </button>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>New Password</label>
                      <div className="password-input-wrapper">
                        <input type={showNewPassword ? 'text' : 'password'} className="form-control" style={{ padding: '12px 16px', paddingRight: 45 }} placeholder="At least 8 characters" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} />
                        <button type="button" className="password-eye-btn" onClick={() => setShowNewPassword(!showNewPassword)} tabIndex={-1}>
                          <i className={`fas fa-eye${showNewPassword ? '-slash' : ''}`}></i>
                        </button>
                      </div>
                      {passwordForm.newPassword && (() => { const s = getPasswordStrength(passwordForm.newPassword); return (
                        <div className="password-strength-bar-container">
                          <div className="password-strength-bar">
                            {[1,2,3,4,5].map(i => (<div key={i} className="password-strength-segment" style={{ background: i <= s.score ? s.color : '#e0e0e0' }}></div>))}
                          </div>
                          <span className="password-strength-label" style={{ color: s.color }}>{s.label}</span>
                        </div>
                      ); })()}
                    </div>
                    <div className="form-group">
                      <label>Confirm New Password</label>
                      <div className="password-input-wrapper">
                        <input type={showConfirmPassword ? 'text' : 'password'} className="form-control" style={{ padding: '12px 16px', paddingRight: 45 }} placeholder="Re-enter new password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} />
                        <button type="button" className="password-eye-btn" onClick={() => setShowConfirmPassword(!showConfirmPassword)} tabIndex={-1}>
                          <i className={`fas fa-eye${showConfirmPassword ? '-slash' : ''}`}></i>
                        </button>
                      </div>
                    </div>
                    {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && <p className="password-mismatch-msg"><i className="fas fa-exclamation-circle"></i> Passwords do not match</p>}
                    <button className="btn-primary profile-save-btn" onClick={changePassword} disabled={profileLoading}>{profileLoading ? <><i className="fas fa-spinner fa-spin"></i> Updating...</> : <><i className="fas fa-key"></i> Update Password</>}</button>
                  </>
                )}
              </div>
            )}

            {profileTab === 'security' && (userRole === 'Admin' || userRole === 'Super Admin') && (
              <div className="profile-form profile-form-v2">
                <div className="profile-form-section-title"><i className="fas fa-shield-alt"></i> Admin Access Password</div>
                <div style={{ padding: '16px 20px', background: 'rgba(146,108,21,0.08)', borderRadius: 12, marginBottom: 20, border: '1px solid rgba(146,108,21,0.2)' }}>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <i className="fas fa-info-circle" style={{ marginRight: 8, color: 'var(--primary)' }}></i>
                    This password is required to access the <strong>Permissions Control</strong> panel. It adds an extra layer of security to prevent unauthorized changes to role permissions.
                  </p>
                </div>

                {hasAdminAccessPassword && (
                  <div style={{ padding: '12px 16px', background: 'rgba(40,167,69,0.08)', borderRadius: 10, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, border: '1px solid rgba(40,167,69,0.2)' }}>
                    <i className="fas fa-check-circle" style={{ color: '#28a745' }}></i>
                    <span style={{ fontSize: '0.85rem', color: '#28a745', fontWeight: 600 }}>Access password is set. You can update it below.</span>
                  </div>
                )}

                <div className="form-group">
                  <label>{hasAdminAccessPassword ? 'New Access Password' : 'Set Access Password'}</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showAdminPassword ? 'text' : 'password'}
                      className="form-control"
                      style={{ padding: '12px 16px', paddingRight: 45 }}
                      placeholder="At least 4 characters"
                      value={adminAccessPassword}
                      onChange={(e) => setAdminAccessPassword(e.target.value)}
                    />
                    <button type="button" className="password-eye-btn" onClick={() => setShowAdminPassword(!showAdminPassword)} tabIndex={-1}>
                      <i className={`fas fa-eye${showAdminPassword ? '-slash' : ''}`}></i>
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label>Confirm Access Password</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showAdminPasswordConfirm ? 'text' : 'password'}
                      className="form-control"
                      style={{ padding: '12px 16px', paddingRight: 45 }}
                      placeholder="Re-enter access password"
                      value={adminAccessPasswordConfirm}
                      onChange={(e) => setAdminAccessPasswordConfirm(e.target.value)}
                    />
                    <button type="button" className="password-eye-btn" onClick={() => setShowAdminPasswordConfirm(!showAdminPasswordConfirm)} tabIndex={-1}>
                      <i className={`fas fa-eye${showAdminPasswordConfirm ? '-slash' : ''}`}></i>
                    </button>
                  </div>
                </div>
                {adminAccessPasswordConfirm && adminAccessPassword !== adminAccessPasswordConfirm && (
                  <p className="password-mismatch-msg"><i className="fas fa-exclamation-circle"></i> Passwords do not match</p>
                )}
                <button className="btn-primary profile-save-btn" onClick={saveAdminAccessPassword} disabled={adminPasswordSaving || !adminAccessPassword || adminAccessPassword !== adminAccessPasswordConfirm}>
                  {adminPasswordSaving ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : <><i className="fas fa-shield-alt"></i> {hasAdminAccessPassword ? 'Update Access Password' : 'Set Access Password'}</>}
                </button>
              </div>
            )}

            {profileTab === 'preferences' && (
              <div className="profile-form profile-form-v2">
                <div className="preference-item">
                  <div><strong>Dark Mode</strong><p style={{ color: '#6c757d', fontSize: '0.85rem' }}>Toggle dark theme for the dashboard</p></div>
                  <label className="switch"><input type="checkbox" checked={darkMode} onChange={toggleDarkMode} /><span className="slider round"></span></label>
                </div>
              </div>
            )}
          </section>

          {/* ========== COMMUNITY EVENTS (All users can browse & RSVP) ========== */}
          <section className={`content-section ${activeSection === 'community-events' ? 'active' : ''}`}>
            <h2 className="section-title">Community Events</h2>
            <p style={{ color: '#6c757d', marginBottom: 20 }}>Browse events created by members and let them know if you&apos;re attending!</p>

            {/* RSVP Detail Modal for Community Events */}
            {viewingUserEventRsvps && activeSection === 'community-events' && (
              <div className="edit-user-modal-overlay" onClick={() => { setViewingUserEventRsvps(null); setUserEventRsvps(null); }}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-users"></i> Responses — {viewingUserEventRsvps.title}</h3>
                    <button className="btn-close-modal" onClick={() => { setViewingUserEventRsvps(null); setUserEventRsvps(null); }}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body" style={{ maxHeight: 500, overflowY: 'auto' }}>
                    {userEventRsvps ? (
                      <>
                        <div style={{ display: 'flex', gap: 15, marginBottom: 20, flexWrap: 'wrap' }}>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(40,167,69,0.1)', border: '1px solid rgba(40,167,69,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#28a745' }}>{userEventRsvps.counts?.going || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#28a745' }}>Going</div>
                          </div>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ffc107' }}>{userEventRsvps.counts?.maybe || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#ffc107' }}>Maybe</div>
                          </div>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc3545' }}>{userEventRsvps.counts?.notGoing || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#dc3545' }}>Not Going</div>
                          </div>
                        </div>
                        {['going', 'maybe', 'notGoing'].map((group) => {
                          const items = userEventRsvps.grouped?.[group] || [];
                          const label = group === 'going' ? 'Going' : group === 'maybe' ? 'Maybe' : 'Not Going';
                          const color = group === 'going' ? '#28a745' : group === 'maybe' ? '#ffc107' : '#dc3545';
                          return items.length > 0 ? (
                            <div key={group} style={{ marginBottom: 15 }}>
                              <h4 style={{ color, marginBottom: 8, fontSize: '0.9rem' }}><i className={`fas fa-${group === 'going' ? 'check-circle' : group === 'maybe' ? 'question-circle' : 'times-circle'}`}></i> {label} ({items.length})</h4>
                              {items.map((r) => (
                                <div key={r.id} style={{ padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eee' }}>
                                  <span style={{ fontWeight: 500 }}>{r.users?.firstname} {r.users?.lastname}</span>
                                  <span style={{ fontSize: '0.8rem', color: '#6c757d' }}>{r.users?.ministry || ''}</span>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })}
                        {(userEventRsvps.counts?.total || 0) === 0 && <p style={{ color: '#6c757d', textAlign: 'center' }}>No responses yet.</p>}
                      </>
                    ) : <p style={{ color: '#6c757d' }}>Loading responses...</p>}
                  </div>
                </div>
              </div>
            )}

            <div className="events-grid">
              {browseUserEvents.map((evt) => (
                <div key={evt.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: '4px solid #17a2b8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(23,162,184,0.15)', color: '#17a2b8', fontWeight: 600, display: 'inline-block', marginBottom: 6 }}>{evt.event_type}</span>
                      <h3 style={{ color: 'var(--primary)', marginBottom: 4, marginTop: 4 }}>{evt.title}</h3>
                      <p style={{ color: '#6c757d', fontSize: '0.8rem', margin: 0 }}><i className="fas fa-user"></i> By: {evt.creator_name || 'Unknown'}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 5, fontSize: '0.8rem' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(40,167,69,0.15)', color: '#28a745' }}>{evt.rsvpCounts?.going || 0} going</span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,193,7,0.15)', color: '#e0a800' }}>{evt.rsvpCounts?.maybe || 0} maybe</span>
                    </div>
                  </div>
                  {evt.description && <p style={{ color: '#6c757d', marginBottom: 8, marginTop: 8 }}>{evt.description}</p>}
                  <p style={{ margin: '4px 0' }}><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                  {evt.end_date && <p style={{ margin: '4px 0' }}><i className="fas fa-hourglass-end"></i> Until: {formatDateTime(evt.end_date)}</p>}
                  {evt.location && <p style={{ margin: '4px 0' }}><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}

                  {/* RSVP Buttons */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    {evt.myRsvp && <span style={{ fontSize: '0.8rem', color: '#6c757d', marginRight: 4 }}>Your response: <strong style={{ color: evt.myRsvp === 'Going' ? '#28a745' : evt.myRsvp === 'Maybe' ? '#e0a800' : '#dc3545' }}>{evt.myRsvp}</strong></span>}
                    <button className="btn-small" style={{ background: evt.myRsvp === 'Going' ? '#28a745' : 'rgba(40,167,69,0.15)', color: evt.myRsvp === 'Going' ? '#fff' : '#28a745', border: '1px solid #28a745' }} onClick={() => handleUserEventRSVP(evt.id, 'Going')}>
                      <i className="fas fa-check"></i> Going
                    </button>
                    <button className="btn-small" style={{ background: evt.myRsvp === 'Maybe' ? '#ffc107' : 'rgba(255,193,7,0.15)', color: evt.myRsvp === 'Maybe' ? '#fff' : '#e0a800', border: '1px solid #ffc107' }} onClick={() => handleUserEventRSVP(evt.id, 'Maybe')}>
                      <i className="fas fa-question"></i> Maybe
                    </button>
                    <button className="btn-small" style={{ background: evt.myRsvp === 'Not Going' ? '#dc3545' : 'rgba(220,53,69,0.15)', color: evt.myRsvp === 'Not Going' ? '#fff' : '#dc3545', border: '1px solid #dc3545' }} onClick={() => handleUserEventRSVP(evt.id, 'Not Going')}>
                      <i className="fas fa-times"></i> Not Going
                    </button>
                    <button className="btn-small btn-info" onClick={() => { setViewingUserEventRsvps(evt); loadUserEventRsvps(evt.id); }} title="View Responses">
                      <i className="fas fa-users"></i> Responses
                    </button>
                  </div>
                </div>
              ))}
              {browseUserEvents.length === 0 && <p style={{ color: '#6c757d' }}>No community events at this time. Check back later!</p>}
            </div>
          </section>

          {/* ========== MY CREATED EVENTS (Users with event permissions) ========== */}
          <section className={`content-section ${activeSection === 'my-created-events' ? 'active' : ''}`}>
            <h2 className="section-title">My Events</h2>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #eee' }}>
              <button onClick={() => setMyEventsTab('mine')} style={{ padding: '10px 24px', border: 'none', borderBottom: myEventsTab === 'mine' ? '3px solid var(--primary)' : '3px solid transparent', background: 'transparent', color: myEventsTab === 'mine' ? 'var(--primary)' : '#6c757d', fontWeight: myEventsTab === 'mine' ? 700 : 500, cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s' }}>
                <i className="fas fa-calendar-alt"></i> My Events
              </button>
              <button onClick={() => { setMyEventsTab('browse'); loadBrowseUserEvents(); }} style={{ padding: '10px 24px', border: 'none', borderBottom: myEventsTab === 'browse' ? '3px solid var(--primary)' : '3px solid transparent', background: 'transparent', color: myEventsTab === 'browse' ? 'var(--primary)' : '#6c757d', fontWeight: myEventsTab === 'browse' ? 700 : 500, cursor: 'pointer', fontSize: '0.95rem', transition: 'all 0.2s' }}>
                <i className="fas fa-globe"></i> Browse All Events
              </button>
            </div>

            {/* ===== MY EVENTS TAB ===== */}
            {myEventsTab === 'mine' && <>

            {(userData?.allowed_event_types || userData?.allowedEventTypes || []).length > 0 && (
              <button className="btn-primary" style={{ marginBottom: 15 }} onClick={() => {
                setShowUserEventForm(true);
                setEditingUserEvent(null);
                setUserEventForm({ title: '', description: '', eventType: (userData?.allowed_event_types || userData?.allowedEventTypes || [])[0] || 'Event', eventDate: '', endDate: '', location: '' });
              }}>
                <i className="fas fa-plus"></i> Create Event
              </button>
            )}

            {/* Create/Edit Form */}
            {showUserEventForm && (
              <div className="form-card" style={{ marginBottom: 20, padding: 20, background: 'var(--bg-card)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3>{editingUserEvent ? 'Edit Event' : 'Create New Event'}</h3>
                <div className="form-group">
                  <label>Event Type *</label>
                  <select className="form-select" style={{ padding: '10px 15px' }} value={userEventForm.eventType} onChange={(e) => setUserEventForm({ ...userEventForm, eventType: e.target.value })}>
                    {(userData?.allowed_event_types || userData?.allowedEventTypes || []).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group"><label>Title *</label><input className="form-control" style={{ padding: '10px 15px' }} value={userEventForm.title} onChange={(e) => setUserEventForm({ ...userEventForm, title: e.target.value })} placeholder="Event title" /></div>
                <div className="form-group"><label>Description</label><textarea className="form-control" style={{ padding: '10px 15px' }} rows={3} value={userEventForm.description} onChange={(e) => setUserEventForm({ ...userEventForm, description: e.target.value })} placeholder="Event description..." /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div className="form-group"><label>Event Date *</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={userEventForm.eventDate} onChange={(e) => setUserEventForm({ ...userEventForm, eventDate: e.target.value })} /></div>
                  <div className="form-group"><label>End Date</label><input type="datetime-local" className="form-control" style={{ padding: '10px 15px' }} value={userEventForm.endDate} onChange={(e) => setUserEventForm({ ...userEventForm, endDate: e.target.value })} /></div>
                </div>
                <div className="form-group"><label>Location</label><input className="form-control" style={{ padding: '10px 15px' }} value={userEventForm.location} onChange={(e) => setUserEventForm({ ...userEventForm, location: e.target.value })} placeholder="Event location" /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn-primary" onClick={handleUserEventSubmit}><i className="fas fa-save"></i> {editingUserEvent ? 'Update' : 'Create'}</button>
                  <button className="btn-secondary" onClick={() => { setShowUserEventForm(false); setEditingUserEvent(null); }}>Cancel</button>
                </div>
              </div>
            )}

            {/* RSVP Detail Modal */}
            {viewingUserEventRsvps && (
              <div className="edit-user-modal-overlay" onClick={() => { setViewingUserEventRsvps(null); setUserEventRsvps(null); }}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-users"></i> Responses — {viewingUserEventRsvps.title}</h3>
                    <button className="btn-close-modal" onClick={() => { setViewingUserEventRsvps(null); setUserEventRsvps(null); }}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body" style={{ maxHeight: 500, overflowY: 'auto' }}>
                    {userEventRsvps ? (
                      <>
                        <div style={{ display: 'flex', gap: 15, marginBottom: 20, flexWrap: 'wrap' }}>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(40,167,69,0.1)', border: '1px solid rgba(40,167,69,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#28a745' }}>{userEventRsvps.counts?.going || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#28a745' }}>Going</div>
                          </div>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ffc107' }}>{userEventRsvps.counts?.maybe || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#ffc107' }}>Maybe</div>
                          </div>
                          <div style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.3)', textAlign: 'center', flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc3545' }}>{userEventRsvps.counts?.notGoing || 0}</div>
                            <div style={{ fontSize: '0.8rem', color: '#dc3545' }}>Not Going</div>
                          </div>
                        </div>
                        {['going', 'maybe', 'notGoing'].map((group) => {
                          const items = userEventRsvps.grouped?.[group] || [];
                          const label = group === 'going' ? 'Going' : group === 'maybe' ? 'Maybe' : 'Not Going';
                          const color = group === 'going' ? '#28a745' : group === 'maybe' ? '#ffc107' : '#dc3545';
                          return items.length > 0 ? (
                            <div key={group} style={{ marginBottom: 15 }}>
                              <h4 style={{ color, marginBottom: 8, fontSize: '0.9rem' }}><i className={`fas fa-${group === 'going' ? 'check-circle' : group === 'maybe' ? 'question-circle' : 'times-circle'}`}></i> {label} ({items.length})</h4>
                              {items.map((r) => (
                                <div key={r.id} style={{ padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eee' }}>
                                  <span style={{ fontWeight: 500 }}>{r.users?.firstname} {r.users?.lastname}</span>
                                  <span style={{ fontSize: '0.8rem', color: '#6c757d' }}>{r.users?.ministry || ''}</span>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })}
                        {(userEventRsvps.counts?.total || 0) === 0 && <p style={{ color: '#6c757d', textAlign: 'center' }}>No responses yet.</p>}
                      </>
                    ) : <p style={{ color: '#6c757d' }}>Loading responses...</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Events List */}
            <div className="events-grid">
              {userEvents.map((evt) => (
                <div key={evt.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: '4px solid var(--primary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(146,108,21,0.15)', color: 'var(--primary)', fontWeight: 600, marginBottom: 6, display: 'inline-block' }}>{evt.event_type}</span>
                      <h3 style={{ color: 'var(--primary)', marginBottom: 4, marginTop: 4 }}>{evt.title}</h3>
                    </div>
                    <div style={{ display: 'flex', gap: 5, fontSize: '0.8rem' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(40,167,69,0.15)', color: '#28a745' }}>{evt.rsvpCounts?.going || 0} going</span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,193,7,0.15)', color: '#e0a800' }}>{evt.rsvpCounts?.maybe || 0} maybe</span>
                    </div>
                  </div>
                  {evt.description && <p style={{ color: '#6c757d', marginBottom: 8 }}>{evt.description}</p>}
                  <p><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                  {evt.end_date && <p><i className="fas fa-hourglass-end"></i> Until: {formatDateTime(evt.end_date)}</p>}
                  {evt.location && <p><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button className="btn-small btn-info" onClick={() => { setViewingUserEventRsvps(evt); loadUserEventRsvps(evt.id); }} title="View Responses"><i className="fas fa-users"></i> Responses</button>
                    <button className="btn-small btn-primary" onClick={() => {
                      setEditingUserEvent(evt);
                      setUserEventForm({
                        title: evt.title, description: evt.description || '',
                        eventType: evt.event_type, eventDate: evt.event_date?.slice(0, 16),
                        endDate: evt.end_date?.slice(0, 16) || '', location: evt.location || '',
                      });
                      setShowUserEventForm(true);
                    }}><i className="fas fa-edit"></i> Edit</button>
                    <button className="btn-small btn-danger" onClick={() => handleDeleteUserEvent(evt.id)}><i className="fas fa-trash"></i> Delete</button>
                  </div>
                </div>
              ))}
              {userEvents.length === 0 && <p style={{ color: '#6c757d' }}>You have not created any events yet. Click &quot;Create Event&quot; to get started!</p>}
            </div>

            </>}

            {/* ===== BROWSE ALL EVENTS TAB ===== */}
            {myEventsTab === 'browse' && <>
              <p style={{ color: '#6c757d', marginBottom: 15 }}>Discover events created by other members and let them know if you&apos;re attending!</p>
              <div className="events-grid">
                {browseUserEvents.filter(evt => evt.created_by !== userData?.id).map((evt) => (
                  <div key={evt.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: '4px solid #17a2b8' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(23,162,184,0.15)', color: '#17a2b8', fontWeight: 600, display: 'inline-block', marginBottom: 6 }}>{evt.event_type}</span>
                        <h3 style={{ color: 'var(--primary)', marginBottom: 4, marginTop: 4 }}>{evt.title}</h3>
                        <p style={{ color: '#6c757d', fontSize: '0.8rem', margin: 0 }}><i className="fas fa-user"></i> By: {evt.creator_name || 'Unknown'}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 5, fontSize: '0.8rem' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(40,167,69,0.15)', color: '#28a745' }}>{evt.rsvpCounts?.going || 0} going</span>
                        <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,193,7,0.15)', color: '#e0a800' }}>{evt.rsvpCounts?.maybe || 0} maybe</span>
                      </div>
                    </div>
                    {evt.description && <p style={{ color: '#6c757d', marginBottom: 8, marginTop: 8 }}>{evt.description}</p>}
                    <p style={{ margin: '4px 0' }}><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                    {evt.end_date && <p style={{ margin: '4px 0' }}><i className="fas fa-hourglass-end"></i> Until: {formatDateTime(evt.end_date)}</p>}
                    {evt.location && <p style={{ margin: '4px 0' }}><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}

                    {/* RSVP Buttons */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                      {evt.myRsvp && <span style={{ fontSize: '0.8rem', color: '#6c757d', marginRight: 4 }}>Your response: <strong style={{ color: evt.myRsvp === 'Going' ? '#28a745' : evt.myRsvp === 'Maybe' ? '#e0a800' : '#dc3545' }}>{evt.myRsvp}</strong></span>}
                      <button className="btn-small" style={{ background: evt.myRsvp === 'Going' ? '#28a745' : 'rgba(40,167,69,0.15)', color: evt.myRsvp === 'Going' ? '#fff' : '#28a745', border: '1px solid #28a745' }} onClick={() => handleUserEventRSVP(evt.id, 'Going')}>
                        <i className="fas fa-check"></i> Going
                      </button>
                      <button className="btn-small" style={{ background: evt.myRsvp === 'Maybe' ? '#ffc107' : 'rgba(255,193,7,0.15)', color: evt.myRsvp === 'Maybe' ? '#fff' : '#e0a800', border: '1px solid #ffc107' }} onClick={() => handleUserEventRSVP(evt.id, 'Maybe')}>
                        <i className="fas fa-question"></i> Maybe
                      </button>
                      <button className="btn-small" style={{ background: evt.myRsvp === 'Not Going' ? '#dc3545' : 'rgba(220,53,69,0.15)', color: evt.myRsvp === 'Not Going' ? '#fff' : '#dc3545', border: '1px solid #dc3545' }} onClick={() => handleUserEventRSVP(evt.id, 'Not Going')}>
                        <i className="fas fa-times"></i> Not Going
                      </button>
                      <button className="btn-small btn-info" onClick={() => { setViewingUserEventRsvps(evt); loadUserEventRsvps(evt.id); }} title="View Responses">
                        <i className="fas fa-users"></i> Responses
                      </button>
                    </div>
                  </div>
                ))}
                {browseUserEvents.filter(evt => evt.created_by !== userData?.id).length === 0 && <p style={{ color: '#6c757d' }}>No events from other members at this time.</p>}
              </div>
            </>}

          </section>

          {/* ========== USER EVENTS OVERSIGHT (Pastor/Admin) ========== */}
          <section className={`content-section ${activeSection === 'user-events-oversight' ? 'active' : ''}`}>
            <h2 className="section-title">User-Created Events</h2>
            <p style={{ color: '#6c757d', marginBottom: 20 }}>View and manage events created by users who have been granted event creation permissions.</p>

            {/* Pastor RSVP Detail Modal */}
            {pastorViewingEvent && (
              <div className="edit-user-modal-overlay" onClick={() => { setPastorViewingEvent(null); setPastorEventRsvps(null); }}>
                <div className="edit-user-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 650 }}>
                  <div className="edit-user-modal-header">
                    <h3><i className="fas fa-info-circle"></i> Event Details</h3>
                    <button className="btn-close-modal" onClick={() => { setPastorViewingEvent(null); setPastorEventRsvps(null); }}><i className="fas fa-times"></i></button>
                  </div>
                  <div className="edit-user-modal-body" style={{ maxHeight: 550, overflowY: 'auto' }}>
                    <div style={{ marginBottom: 20 }}>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(146,108,21,0.15)', color: 'var(--primary)', fontWeight: 600 }}>{pastorViewingEvent.event_type}</span>
                      <h3 style={{ color: 'var(--primary)', marginTop: 8, marginBottom: 6 }}>{pastorViewingEvent.title}</h3>
                      {pastorViewingEvent.description && <p style={{ color: '#6c757d', marginBottom: 10 }}>{pastorViewingEvent.description}</p>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 15 }}>
                        <div style={{ padding: 12, background: 'rgba(146,108,21,0.05)', borderRadius: 8 }}>
                          <div style={{ fontSize: '0.8rem', color: '#6c757d' }}>Date & Time</div>
                          <div style={{ fontWeight: 600 }}>{formatDateTime(pastorViewingEvent.event_date)}</div>
                        </div>
                        {pastorViewingEvent.location && (
                          <div style={{ padding: 12, background: 'rgba(146,108,21,0.05)', borderRadius: 8 }}>
                            <div style={{ fontSize: '0.8rem', color: '#6c757d' }}>Location</div>
                            <div style={{ fontWeight: 600 }}>{pastorViewingEvent.location}</div>
                          </div>
                        )}
                      </div>
                      <div style={{ padding: 12, background: 'rgba(0,123,255,0.05)', borderRadius: 8, border: '1px solid rgba(0,123,255,0.15)', marginBottom: 15 }}>
                        <div style={{ fontSize: '0.8rem', color: '#6c757d', marginBottom: 4 }}>Created By</div>
                        <div style={{ fontWeight: 600 }}>{pastorViewingEvent.created_by_name || (pastorViewingEvent.users ? `${pastorViewingEvent.users.firstname} ${pastorViewingEvent.users.lastname}` : 'Unknown')}</div>
                        <div style={{ fontSize: '0.8rem', color: '#6c757d' }}>
                          {pastorViewingEvent.users?.ministry && <span><i className="fas fa-church" style={{ marginRight: 4 }}></i>{pastorViewingEvent.users.ministry}</span>}
                          {pastorViewingEvent.users?.role && <span style={{ marginLeft: 12 }}><i className="fas fa-user-tag" style={{ marginRight: 4 }}></i>{pastorViewingEvent.users.role}</span>}
                        </div>
                      </div>
                    </div>

                    <h4 style={{ marginBottom: 10, color: 'var(--primary)' }}><i className="fas fa-users"></i> User Responses</h4>
                    {pastorEventRsvps ? (
                      <>
                        <div style={{ display: 'flex', gap: 15, marginBottom: 15, flexWrap: 'wrap' }}>
                          <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(40,167,69,0.1)', border: '1px solid rgba(40,167,69,0.3)', textAlign: 'center', flex: 1, minWidth: 70 }}>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#28a745' }}>{pastorEventRsvps.counts?.going || 0}</div>
                            <div style={{ fontSize: '0.75rem', color: '#28a745' }}>Going</div>
                          </div>
                          <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', textAlign: 'center', flex: 1, minWidth: 70 }}>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ffc107' }}>{pastorEventRsvps.counts?.maybe || 0}</div>
                            <div style={{ fontSize: '0.75rem', color: '#ffc107' }}>Maybe</div>
                          </div>
                          <div style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.3)', textAlign: 'center', flex: 1, minWidth: 70 }}>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#dc3545' }}>{pastorEventRsvps.counts?.notGoing || 0}</div>
                            <div style={{ fontSize: '0.75rem', color: '#dc3545' }}>Not Going</div>
                          </div>
                        </div>
                        {['going', 'maybe', 'notGoing'].map((group) => {
                          const items = pastorEventRsvps.grouped?.[group] || [];
                          const label = group === 'going' ? 'Going' : group === 'maybe' ? 'Maybe' : 'Not Going';
                          const color = group === 'going' ? '#28a745' : group === 'maybe' ? '#ffc107' : '#dc3545';
                          return items.length > 0 ? (
                            <div key={group} style={{ marginBottom: 12 }}>
                              <h4 style={{ color, marginBottom: 6, fontSize: '0.85rem' }}><i className={`fas fa-${group === 'going' ? 'check-circle' : group === 'maybe' ? 'question-circle' : 'times-circle'}`}></i> {label} ({items.length})</h4>
                              {items.map((r) => (
                                <div key={r.id} style={{ padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6, marginBottom: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eee', fontSize: '0.9rem' }}>
                                  <span style={{ fontWeight: 500 }}>{r.users?.firstname} {r.users?.lastname}</span>
                                  <span style={{ fontSize: '0.78rem', color: '#6c757d' }}>{r.users?.ministry || ''} • {r.users?.role || ''}</span>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })}
                        {(pastorEventRsvps.counts?.total || 0) === 0 && <p style={{ color: '#6c757d', textAlign: 'center' }}>No responses yet.</p>}
                      </>
                    ) : <p style={{ color: '#6c757d' }}>Loading responses...</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Event Cards */}
            <div className="events-grid">
              {allUserEventsForPastor.map((evt) => (
                <div key={evt.id} style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, marginBottom: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)', borderLeft: '4px solid var(--primary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '0.75rem', padding: '2px 10px', borderRadius: 12, background: 'rgba(146,108,21,0.15)', color: 'var(--primary)', fontWeight: 600, display: 'inline-block', marginBottom: 6 }}>{evt.event_type}</span>
                      <h3 style={{ color: 'var(--primary)', marginBottom: 4, marginTop: 2 }}>{evt.title}</h3>
                    </div>
                    <div style={{ display: 'flex', gap: 5, fontSize: '0.8rem' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(40,167,69,0.15)', color: '#28a745' }}>{evt.rsvpCounts?.going || 0} going</span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,193,7,0.15)', color: '#e0a800' }}>{evt.rsvpCounts?.maybe || 0} maybe</span>
                    </div>
                  </div>
                  {evt.description && <p style={{ color: '#6c757d', marginBottom: 8 }}>{evt.description}</p>}
                  <p><i className="fas fa-clock"></i> {formatDateTime(evt.event_date)}</p>
                  {evt.location && <p><i className="fas fa-map-marker-alt"></i> {evt.location}</p>}
                  <div style={{ padding: '8px 12px', background: 'rgba(0,123,255,0.05)', borderRadius: 8, border: '1px solid rgba(0,123,255,0.15)', marginTop: 8, fontSize: '0.85rem' }}>
                    <i className="fas fa-user" style={{ marginRight: 6, color: '#007bff' }}></i>
                    <strong>Created by:</strong> {evt.created_by_name || (evt.users ? `${evt.users.firstname} ${evt.users.lastname}` : 'Unknown')}
                    {evt.users?.ministry && <span style={{ marginLeft: 10, color: '#6c757d' }}>({evt.users.ministry})</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button className="btn-small btn-info" onClick={() => { setPastorViewingEvent(evt); loadPastorEventRsvps(evt.id); }}><i className="fas fa-eye"></i> View Details & Responses</button>
                    <button className="btn-small btn-primary" onClick={() => {
                      setEditingUserEvent(evt);
                      setUserEventForm({
                        title: evt.title, description: evt.description || '',
                        eventType: evt.event_type, eventDate: evt.event_date?.slice(0, 16),
                        endDate: evt.end_date?.slice(0, 16) || '', location: evt.location || '',
                      });
                      setShowUserEventForm(true);
                    }}><i className="fas fa-edit"></i> Edit</button>
                    <button className="btn-small btn-danger" onClick={() => handleDeleteUserEvent(evt.id)}><i className="fas fa-trash"></i> Delete</button>
                  </div>
                </div>
              ))}
              {allUserEventsForPastor.length === 0 && <p style={{ color: '#6c757d' }}>No user-created events found.</p>}
            </div>
          </section>

          {/* ========== PRAISE & WORSHIP SECTION ========== */}
          <section className={`content-section ${activeSection === 'praise-worship' ? 'active' : ''}`}>
            <div className="paw-page-header">
              <div className="paw-page-title-row">
                <h2 className="section-title paw-main-title"><i className="fas fa-hands-praying"></i> Praise & Worship</h2>
                <span className="paw-role-badge">
                  <i className={`fas ${
                    (userData?.sub_role || '').includes('Song Leader') ? 'fa-microphone' :
                    (userData?.sub_role || '').includes('Backup Singer') ? 'fa-users' :
                    (userData?.sub_role || '').includes('Instrumentalist') ? 'fa-guitar' :
                    (userData?.sub_role || '').includes('Dancer') || (userData?.ministry || '') === 'Dancers' ? 'fa-person-running' :
                    (userData?.ministry || '') === 'Media' ? 'fa-desktop' :
                    (userData?.ministry || '') === 'Pastors' || userRole === 'Pastor' ? 'fa-cross' :
                    'fa-music'
                  }`}></i>
                  {userData?.sub_role || userData?.ministry || userRole}
                </span>
              </div>

              {/* AI Bible Verse Encouragement */}
              <div className="paw-bible-verse-card">
                <div className="paw-bible-verse-glow"></div>
                {pawBibleVerseLoading ? (
                  <div className="paw-bible-loading"><i className="fas fa-spinner fa-spin"></i> Generating encouragement...</div>
                ) : pawBibleVerse ? (
                  <>
                    <div className="paw-bible-verse-icon"><i className="fas fa-bible"></i></div>
                    <div className="paw-bible-verse-content">
                      <p className="paw-bible-verse-text">&ldquo;{pawBibleVerse.verse}&rdquo;</p>
                      <p className="paw-bible-verse-ref">— {pawBibleVerse.reference}</p>
                      {pawBibleVerse.encouragement && <p className="paw-bible-verse-encourage"><i className="fas fa-heart"></i> {pawBibleVerse.encouragement}</p>}
                    </div>
                  </>
                ) : (
                  <div className="paw-bible-loading">
                    <i className="fas fa-bible"></i> <span>&ldquo;Sing to the Lord a new song; sing to the Lord, all the earth.&rdquo; — Psalm 96:1</span>
                  </div>
                )}
              </div>
            </div>

            {/* PAW Tab Bar */}
            <div className="paw-tab-bar">
              <button className={`paw-tab ${pawTab === 'schedules' ? 'active' : ''}`} onClick={() => { setPawTab('schedules'); loadPawSchedules(); loadSubRequests(); }}>
                <i className="fas fa-calendar-alt"></i> Schedule Lineups
              </button>
              <button className={`paw-tab ${pawTab === 'my-schedule' ? 'active' : ''}`} onClick={() => { setPawTab('my-schedule'); loadPawMySchedules(); loadSubRequests(); }}>
                <i className="fas fa-user-check"></i> My Schedule
              </button>
              <button className={`paw-tab ${pawTab === 'notifications' ? 'active' : ''}`} onClick={() => { setPawTab('notifications'); loadPawNotifications(); }}>
                <i className="fas fa-bell"></i> Notifications
                {pawNotifications.filter(n => !n.is_read).length > 0 && (
                  <span className="paw-notif-badge">{pawNotifications.filter(n => !n.is_read).length}</span>
                )}
              </button>
              {isMultimediaUser && (
                <button className={`paw-tab ${pawTab === 'lyrics-library' ? 'active' : ''}`} onClick={() => { setPawTab('lyrics-library'); loadLyricsLibrary(); loadMultimediaLineupNotifs(); }}>
                  <i className="fas fa-file-audio"></i> Lyrics
                </button>
              )}
            </div>

            {/* SCHEDULES TAB */}
            {pawTab === 'schedules' && (
              <div>
              {/* Open Sub Requests Banner — visible to all PAW members */}
              {(() => {
                const openSubs = getOpenSubsForMe();
                if (openSubs.length === 0) return null;
                const userSubRole = userData?.sub_role || '';
                const myRoleLabel = userSubRole.includes('Song Leaders') ? 'Song Leader' : userSubRole.includes('Backup Singer') ? 'Backup Singer' : userSubRole.includes('Instrumentalist') ? 'Instrumentalist' : userSubRole.includes('Dancer') ? 'Dancer' : 'member';
                return (
                  <div className="paw-open-subs-banner" style={{ marginBottom: 16, background: 'linear-gradient(135deg, rgba(156,39,176,0.15), rgba(103,58,183,0.12))', border: '1px solid rgba(156,39,176,0.3)', borderRadius: 14, padding: '16px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <i className="fas fa-people-arrows" style={{ color: '#ce93d8', fontSize: '1.1rem' }}></i>
                      <h4 style={{ color: '#ce93d8', margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>🔔 Open Sub Requests <span style={{ background: '#9c27b0', color: '#fff', borderRadius: 12, padding: '2px 8px', fontSize: '0.75rem', marginLeft: 6 }}>{openSubs.length}</span></h4>
                    </div>
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem', margin: '0 0 12px', lineHeight: 1.4 }}>A fellow {myRoleLabel} needs a substitute. Can you help?</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {openSubs.map(sub => (
                        <div key={sub.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(156,39,176,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                              {sub.requester_profile_picture ? <img src={sub.requester_profile_picture} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#ce93d8' }}>{getInitials(sub.requester_name)}</span>}
                            </div>
                            <div style={{ flex: 1 }}>
                              <strong style={{ fontSize: '0.85rem', color: '#fff' }}>{sub.requester_name}</strong>
                              <span style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginTop: 2 }}><i className="fas fa-calendar-day"></i> {formatDate(sub.schedule_date)}</span>
                            </div>
                            <span style={{ background: 'rgba(156,39,176,0.25)', color: '#ce93d8', fontSize: '0.7rem', padding: '3px 8px', borderRadius: 8, fontWeight: 600 }}>{sub.role_type || 'Song Leader'}</span>
                          </div>
                          <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}><i className="fas fa-quote-left" style={{ marginRight: 4, fontSize: '0.65rem' }}></i>{sub.reason}</span>
                          <button className="paw-open-sub-accept-btn" onClick={() => acceptSubRequest(sub.id)} style={{ alignSelf: 'flex-end', padding: '6px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #9c27b0, #7b1fa2)', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <i className="fas fa-hand-holding-heart"></i> I&apos;ll Sub!
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="paw-schedules-grid">
                {pawSchedules.filter(s => new Date(s.scheduleDate) >= new Date(new Date().toDateString())).sort((a, b) => new Date(a.scheduleDate) - new Date(b.scheduleDate)).length === 0 && (
                  <div className="paw-empty-state">
                    <i className="fas fa-calendar-xmark"></i>
                    <p>No upcoming schedule lineups found.</p>
                    <span>Check back later for new assignments!</span>
                  </div>
                )}
                {pawSchedules.filter(s => new Date(s.scheduleDate) >= new Date(new Date().toDateString())).sort((a, b) => new Date(a.scheduleDate) - new Date(b.scheduleDate)).map((schedule, idx) => (
                  <div key={idx} className="paw-card-v2" onClick={() => setPawSelectedSchedule(schedule)}>
                    {/* Card Header with date */}
                    <div className="paw-card-v2-header">
                      <div className="paw-card-v2-date">
                        <span className="paw-card-v2-day">{new Date(schedule.scheduleDate + 'T00:00:00').getDate()}</span>
                        <div className="paw-card-v2-month-year">
                          <span>{new Date(schedule.scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</span>
                          <span>{new Date(schedule.scheduleDate + 'T00:00:00').getFullYear()}</span>
                        </div>
                      </div>
                      <div className="paw-card-v2-weekday">{new Date(schedule.scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}</div>
                      {schedule.hasSubstitute && <span className="paw-sub-tag"><i className="fas fa-people-arrows"></i> Substituted</span>}
                    </div>

                    {/* Song Leader Section with Profile */}
                    <div className="paw-card-v2-body">
                      <div className="paw-card-v2-leader">
                        <div className="paw-card-v2-avatar-wrapper">
                          {schedule.songLeaderPicture ? (
                            <img src={schedule.songLeaderPicture} alt="" className="paw-card-v2-avatar" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="paw-card-v2-avatar paw-card-v2-avatar-initials">{getInitials(schedule.songLeader)}</div>
                          )}
                          <span className="paw-card-v2-role-icon"><i className="fas fa-microphone"></i></span>
                        </div>
                        <div className="paw-card-v2-leader-info">
                          <span className="paw-card-v2-label">{schedule.hasSubstitute ? 'Song Leader (Substitute)' : 'Song Leader'}</span>
                          <span className="paw-card-v2-name">{schedule.songLeader}</span>
                        </div>
                      </div>

                      {/* Original Song Leader (grayed out) */}
                      {schedule.hasSubstitute && schedule.originalSongLeader && (
                        <div className="paw-card-v2-leader paw-card-v2-original">
                          <div className="paw-card-v2-avatar-wrapper">
                            {schedule.originalSongLeaderPicture ? (
                              <img src={schedule.originalSongLeaderPicture} alt="" className="paw-card-v2-avatar" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="paw-card-v2-avatar paw-card-v2-avatar-initials">{getInitials(schedule.originalSongLeader)}</div>
                            )}
                          </div>
                          <div className="paw-card-v2-leader-info">
                            <span className="paw-card-v2-label">Song Leader</span>
                            <span className="paw-card-v2-name paw-grayed-out">{schedule.originalSongLeader}</span>
                          </div>
                        </div>
                      )}

                      {/* Backup Singers with Avatars */}
                      {schedule.backupSingerProfiles?.length > 0 && (
                        <div className="paw-card-v2-backups">
                          <span className="paw-card-v2-label"><i className="fas fa-users"></i> Backup Singers</span>
                          <div className="paw-card-v2-backup-list">
                            {schedule.backupSingerProfiles.map((bp, i) => (
                              <div key={i} className="paw-card-v2-backup-chip">
                                {bp.profilePicture ? (
                                  <img src={bp.profilePicture} alt="" className="paw-card-v2-backup-avatar" referrerPolicy="no-referrer" />
                                ) : (
                                  <span className="paw-card-v2-backup-avatar paw-card-v2-avatar-initials">{getInitials(bp.name)}</span>
                                )}
                                <span>{bp.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Practice & Songs footer */}
                      <div className="paw-card-v2-meta">
                        {schedule.practiceDate && (
                          <span className="paw-card-v2-meta-item"><i className="fas fa-calendar-check"></i> Practice: {new Date(schedule.practiceDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                        <span className="paw-card-v2-meta-item"><i className="fas fa-music"></i> {(schedule.slowSongs?.length || 0) + (schedule.fastSongs?.length || 0)} Songs</span>
                      </div>
                    </div>

                    <div className="paw-card-v2-footer">
                      <button className="paw-view-btn-v2"><i className="fas fa-eye"></i> View Details</button>
                    </div>
                  </div>
                ))}
              </div>
              </div>
            )}

            {/* MY SCHEDULE TAB */}
            {pawTab === 'my-schedule' && (
              <div className="paw-my-schedule-container">
                {/* Open Sub Requests Banner for My Schedule tab */}
                {(() => {
                  const openSubs = getOpenSubsForMe();
                  if (openSubs.length === 0) return null;
                  const userSubRole = userData?.sub_role || '';
                  const myRoleLabel = userSubRole.includes('Song Leaders') ? 'Song Leader' : userSubRole.includes('Backup Singer') ? 'Backup Singer' : userSubRole.includes('Instrumentalist') ? 'Instrumentalist' : userSubRole.includes('Dancer') ? 'Dancer' : 'member';
                  return (
                    <div className="paw-open-subs-banner" style={{ marginBottom: 16, background: 'linear-gradient(135deg, rgba(156,39,176,0.15), rgba(103,58,183,0.12))', border: '1px solid rgba(156,39,176,0.3)', borderRadius: 14, padding: '16px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <i className="fas fa-people-arrows" style={{ color: '#ce93d8', fontSize: '1.1rem' }}></i>
                        <h4 style={{ color: '#ce93d8', margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>🔔 {myRoleLabel} Sub Needed! <span style={{ background: '#9c27b0', color: '#fff', borderRadius: 12, padding: '2px 8px', fontSize: '0.75rem', marginLeft: 6 }}>{openSubs.length}</span></h4>
                      </div>
                      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem', margin: '0 0 12px', lineHeight: 1.4 }}>A fellow {myRoleLabel} needs someone to fill in. Tap below to volunteer!</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {openSubs.map(sub => (
                          <div key={sub.id} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(156,39,176,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                {sub.requester_profile_picture ? <img src={sub.requester_profile_picture} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#ce93d8' }}>{getInitials(sub.requester_name)}</span>}
                              </div>
                              <div style={{ flex: 1 }}>
                                <strong style={{ fontSize: '0.85rem', color: '#fff' }}>{sub.requester_name}</strong>
                                <span style={{ display: 'block', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginTop: 2 }}><i className="fas fa-calendar-day"></i> {formatDate(sub.schedule_date)}</span>
                              </div>
                              <span style={{ background: 'rgba(156,39,176,0.25)', color: '#ce93d8', fontSize: '0.7rem', padding: '3px 8px', borderRadius: 8, fontWeight: 600 }}>{sub.role_type || 'Song Leader'}</span>
                            </div>
                            <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}><i className="fas fa-quote-left" style={{ marginRight: 4, fontSize: '0.65rem' }}></i>{sub.reason}</span>
                            <button className="paw-open-sub-accept-btn" onClick={() => acceptSubRequest(sub.id)} style={{ alignSelf: 'flex-end', padding: '6px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #9c27b0, #7b1fa2)', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <i className="fas fa-hand-holding-heart"></i> I&apos;ll Sub!
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {pawMySchedules.length === 0 ? (
                  <div className="paw-empty-state">
                    <i className="fas fa-user-clock"></i>
                    <p>No upcoming schedules assigned to you.</p>
                    <span>When the Song Leader adds you to a lineup, it will appear here.</span>
                  </div>
                ) : (
                  <div className="paw-schedules-grid">
                    {pawMySchedules.map((schedule, idx) => (
                      <div key={idx} className="paw-card-v2 paw-card-v2-my" onClick={() => setPawSelectedSchedule(schedule)}>
                        {/* Role Badge */}
                        <div className="paw-card-v2-role-badge" style={{ background: schedule.role === 'Song Leader' ? '#926c15' : schedule.role === 'Substitute Song Leader' ? '#28a745' : schedule.role?.includes('Substituted') ? '#6c757d' : '#17a2b8' }}>
                          <i className={`fas ${schedule.role === 'Song Leader' ? 'fa-microphone' : schedule.role === 'Substitute Song Leader' ? 'fa-people-arrows' : schedule.role?.includes('Substituted') ? 'fa-user-slash' : 'fa-users'}`}></i>
                          {schedule.role}
                        </div>
                        <div className="paw-card-v2-header">
                          <div className="paw-card-v2-date">
                            <span className="paw-card-v2-day">{new Date(schedule.scheduleDate + 'T00:00:00').getDate()}</span>
                            <div className="paw-card-v2-month-year">
                              <span>{new Date(schedule.scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</span>
                              <span>{new Date(schedule.scheduleDate + 'T00:00:00').getFullYear()}</span>
                            </div>
                          </div>
                          <div className="paw-card-v2-weekday">{new Date(schedule.scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}</div>
                          {schedule.hasSubstitute && <span className="paw-sub-tag"><i className="fas fa-people-arrows"></i> Substituted</span>}
                        </div>

                        <div className="paw-card-v2-body">
                          <div className="paw-card-v2-leader">
                            <div className="paw-card-v2-avatar-wrapper">
                              {schedule.songLeaderPicture ? (
                                <img src={schedule.songLeaderPicture} alt="" className="paw-card-v2-avatar" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="paw-card-v2-avatar paw-card-v2-avatar-initials">{getInitials(schedule.songLeader)}</div>
                              )}
                              <span className="paw-card-v2-role-icon"><i className="fas fa-microphone"></i></span>
                            </div>
                            <div className="paw-card-v2-leader-info">
                              <span className="paw-card-v2-label">{schedule.hasSubstitute ? 'Song Leader (Substitute)' : 'Song Leader'}</span>
                              <span className="paw-card-v2-name">{schedule.songLeader}</span>
                            </div>
                          </div>

                          {schedule.hasSubstitute && schedule.originalSongLeader && (
                            <div className="paw-card-v2-leader paw-card-v2-original">
                              <div className="paw-card-v2-avatar-wrapper">
                                {schedule.originalSongLeaderPicture ? (
                                  <img src={schedule.originalSongLeaderPicture} alt="" className="paw-card-v2-avatar" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="paw-card-v2-avatar paw-card-v2-avatar-initials">{getInitials(schedule.originalSongLeader)}</div>
                                )}
                              </div>
                              <div className="paw-card-v2-leader-info">
                                <span className="paw-card-v2-label">Song Leader</span>
                                <span className="paw-card-v2-name paw-grayed-out">{schedule.originalSongLeader}</span>
                              </div>
                            </div>
                          )}

                          {schedule.backupSingerProfiles?.length > 0 && (
                            <div className="paw-card-v2-backups">
                              <span className="paw-card-v2-label"><i className="fas fa-users"></i> Backup Singers</span>
                              <div className="paw-card-v2-backup-list">
                                {schedule.backupSingerProfiles.map((bp, i) => (
                                  <div key={i} className="paw-card-v2-backup-chip">
                                    {bp.profilePicture ? (
                                      <img src={bp.profilePicture} alt="" className="paw-card-v2-backup-avatar" referrerPolicy="no-referrer" />
                                    ) : (
                                      <span className="paw-card-v2-backup-avatar paw-card-v2-avatar-initials">{getInitials(bp.name)}</span>
                                    )}
                                    <span>{bp.name}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="paw-card-v2-meta">
                            {schedule.practiceDate && (
                              <span className="paw-card-v2-meta-item"><i className="fas fa-calendar-check"></i> Practice: {new Date(schedule.practiceDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            )}
                            <span className="paw-card-v2-meta-item"><i className="fas fa-music"></i> {(schedule.slowSongs?.length || 0) + (schedule.fastSongs?.length || 0)} Songs</span>
                          </div>
                        </div>

                        <div className="paw-card-v2-footer">
                          <button className="paw-view-btn-v2" onClick={(e) => { e.stopPropagation(); setPawSelectedSchedule(schedule); }}><i className="fas fa-eye"></i> View Details</button>
                        </div>
                        {/* Substitute action row for assigned non-Song-Leader cards */}
                        {(() => {
                          const isPast = new Date(schedule.scheduleDate + 'T00:00:00') < new Date(new Date().toDateString());
                          const cardRoleType = schedule.role === 'Backup Singer' ? 'Backup Singer' : schedule.role === 'Instrumentalist' ? 'Instrumentalist' : schedule.role === 'Dancer' ? 'Dancer' : null;
                          if (isPast || !cardRoleType || schedule.role?.includes('Substituted')) return null;
                          const mySub = getSubForDate(schedule.scheduleDate, cardRoleType);
                          return (
                            <div className="paw-card-v2-actions-row" onClick={(e) => e.stopPropagation()}>
                              {mySub ? (
                                <span className={`paw-card-action-status ${mySub.status === 'Pending Admin' ? 'pending' : mySub.status === 'Open for Sub' ? 'open' : mySub.status === 'Accepted' ? 'accepted' : 'default'}`}>
                                  <i className="fas fa-people-arrows"></i> Sub: {mySub.status === 'Pending Admin' ? 'Pending' : mySub.status}
                                </span>
                              ) : (
                                <button className="paw-card-action-btn substitute" onClick={(e) => { e.stopPropagation(); setSubModalDate(schedule.scheduleDate); setSubModalScheduleId(schedule.scheduleId || null); setSubModalRoleType(cardRoleType); setSubReason(''); }}>
                                  <i className="fas fa-people-arrows"></i> Request Sub
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick Actions for Backup Singers, Instrumentalists, Dancers */}
                {(() => {
                  const userSubRole = userData?.sub_role || '';
                  const isBackupSinger = userSubRole.includes('Backup Singer');
                  const isInstrumentalist = userSubRole.includes('Instrumentalist');
                  const isDancer = userSubRole.includes('Dancer');
                  const isSongLeader = userSubRole.includes('Song Leaders');
                  const isPAW = userSubRole.includes('Praise And Worship') || isBackupSinger || isInstrumentalist || isDancer;
                  const myRoleLabel = isBackupSinger ? 'Backup Singer' : isInstrumentalist ? 'Instrumentalist' : isDancer ? 'Dancer' : null;
                  const myRoleIcon = isBackupSinger ? 'fa-users' : isInstrumentalist ? 'fa-guitar' : isDancer ? 'fa-shoe-prints' : null;
                  const myRoleColor = isBackupSinger ? '#17a2b8' : isInstrumentalist ? '#6f42c1' : isDancer ? '#e83e8c' : '#926c15';

                  // Show for Backup Singers, Instrumentalists, Dancers (not Song Leaders — they use the lineup calendar)
                  if (!isPAW || !myRoleLabel || isSongLeader) return null;

                  const myExcuses = lineupExcuses.filter(e => e.user_id === userData?.id && (e.role_type || '') === myRoleLabel);
                  const mySubs = subRequests.filter(s => s.requester_id === userData?.id && (s.role_type || '') === myRoleLabel && s.status !== 'Cancelled' && s.status !== 'Rejected');

                  // Calendar helpers
                  const calYear = pawActionCalMonth.getFullYear();
                  const calMonth = pawActionCalMonth.getMonth();
                  const firstDay = new Date(calYear, calMonth, 1).getDay();
                  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
                  const calDays = [];
                  for (let i = 0; i < firstDay; i++) calDays.push(null);
                  for (let d = 1; d <= daysInMonth; d++) calDays.push(d);

                  const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);

                  const getDateStr = (day) => `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                  return (
                    <div className="paw-quick-actions-section">
                      <div className="paw-quick-actions-header">
                        <i className={`fas ${myRoleIcon}`} style={{ color: myRoleColor }}></i>
                        <h3>{myRoleLabel} — Excuse &amp; Substitute</h3>
                      </div>
                      <p className="paw-quick-actions-desc">
                        <i className="fas fa-info-circle"></i> Tap any <strong>future Sunday</strong> on the calendar to file an excuse or request a substitute.
                      </p>

                      {/* Calendar */}
                      <div className="paw-action-calendar-card">
                        <div className="paw-action-cal-header">
                          <button onClick={() => setPawActionCalMonth(new Date(calYear, calMonth - 1))}><i className="fas fa-chevron-left"></i></button>
                          <h3>{pawActionCalMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                          <button onClick={() => setPawActionCalMonth(new Date(calYear, calMonth + 1))}><i className="fas fa-chevron-right"></i></button>
                        </div>
                        <div className="paw-action-cal-weekdays">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="paw-action-cal-wd">{d}</div>)}
                        </div>
                        <div className="paw-action-cal-grid">
                          {calDays.map((day, i) => {
                            if (!day) return <div key={i} className="paw-action-cal-day empty"></div>;
                            const dateStr = getDateStr(day);
                            const date = new Date(calYear, calMonth, day);
                            const isPast = date < todayDate;
                            const isSunday = date.getDay() === 0;
                            const isToday = date.getTime() === todayDate.getTime();
                            const excuse = myExcuses.find(e => e.excuse_date === dateStr);
                            const sub = mySubs.find(s => s.schedule_date === dateStr);
                            const isAssigned = pawMySchedules.some(s => s.scheduleDate === dateStr && s.role === myRoleLabel);
                            const isClickable = !isPast && isSunday;
                            return (
                              <div key={i}
                                className={`paw-action-cal-day${isPast ? ' past' : ''}${isToday ? ' today' : ''}${isSunday ? ' sunday' : ''}${excuse ? ' has-excuse' : ''}${sub ? ' has-sub' : ''}${isAssigned ? ' assigned' : ''}${isClickable ? ' clickable' : ''}`}
                                onClick={() => {
                                  if (!isClickable) return;
                                  // Open action picker modal for this date — include isAssigned so modal can conditionally show sub button
                                  setPawActionModal({ date: dateStr, roleType: myRoleLabel, isAssigned });
                                }}
                                title={isPast ? 'Past date' : !isSunday ? '' : excuse ? `Excuse: ${excuse.status}` : sub ? `Sub: ${sub.status === 'Pending Admin' ? 'Pending' : sub.status}` : isAssigned ? 'You\'re assigned — tap for actions' : 'Tap to file excuse or request sub'}
                              >
                                <span className="paw-action-cal-num">{day}</span>
                                {isSunday && !isPast && (
                                  <div className="paw-action-cal-dots">
                                    {excuse && <span className={`paw-action-cal-dot excuse-dot ${excuse.status.toLowerCase()}`}></span>}
                                    {sub && <span className={`paw-action-cal-dot sub-dot ${sub.status === 'Pending Admin' ? 'pending' : sub.status === 'Accepted' ? 'accepted' : sub.status === 'Open for Sub' ? 'open' : 'default'}`}></span>}
                                    {isAssigned && !excuse && !sub && <span className="paw-action-cal-dot assigned-dot"></span>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="paw-action-cal-legend">
                          <span><span className="legend-dot" style={{ background: myRoleColor }}></span> Assigned</span>
                          <span><span className="legend-dot" style={{ background: '#ffc107' }}></span> Excuse Pending</span>
                          <span><span className="legend-dot" style={{ background: '#28a745' }}></span> Excuse Approved</span>
                          <span><span className="legend-dot" style={{ background: '#9c27b0' }}></span> Sub Request</span>
                          <span><span className="legend-dot past"></span> Past</span>
                        </div>
                      </div>

                      {/* Date Action Picker Modal */}
                      {pawActionModal && (
                        <div className="um-modal-overlay" onClick={() => setPawActionModal(null)}>
                          <div className="paw-date-action-modal" onClick={(e) => e.stopPropagation()}>
                            <div className="paw-date-action-header">
                              <div className="paw-date-action-date-display">
                                <span className="paw-date-action-day">{new Date(pawActionModal.date + 'T00:00:00').getDate()}</span>
                                <div className="paw-date-action-month-col">
                                  <span>{new Date(pawActionModal.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long' })}</span>
                                  <span>{new Date(pawActionModal.date + 'T00:00:00').getFullYear()}</span>
                                </div>
                                <span className="paw-date-action-weekday">{new Date(pawActionModal.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}</span>
                              </div>
                              <span className="paw-date-action-role-badge" style={{ background: myRoleColor }}>
                                <i className={`fas ${myRoleIcon}`}></i> {myRoleLabel}
                              </span>
                              <button className="btn-close-modal" onClick={() => setPawActionModal(null)}><i className="fas fa-times"></i></button>
                            </div>
                            <div className="paw-date-action-body">
                              {/* Show existing excuse/sub status */}
                              {(() => {
                                const exc = myExcuses.find(e => e.excuse_date === pawActionModal.date);
                                const sub = mySubs.find(s => s.schedule_date === pawActionModal.date);
                                return (
                                  <>
                                    {exc && (
                                      <div className={`paw-date-action-status-card ${exc.status.toLowerCase()}`}>
                                        <i className="fas fa-calendar-minus"></i>
                                        <div>
                                          <strong>Excuse: {exc.status}</strong>
                                          <p>{exc.reason}</p>
                                        </div>
                                        {exc.status === 'Pending' && (
                                          <button className="paw-date-action-cancel" onClick={() => { cancelExcuse(exc.id); setPawActionModal(null); }}><i className="fas fa-times"></i> Cancel</button>
                                        )}
                                      </div>
                                    )}
                                    {sub && (
                                      <div className={`paw-date-action-status-card ${sub.status === 'Pending Admin' ? 'pending' : sub.status === 'Accepted' ? 'accepted' : 'open'}`}>
                                        <i className="fas fa-people-arrows"></i>
                                        <div>
                                          <strong>Sub: {sub.status === 'Pending Admin' ? 'Pending Approval' : sub.status}</strong>
                                          <p>{sub.reason}</p>
                                          {sub.status === 'Accepted' && sub.substitute_name && <p><i className="fas fa-user-check"></i> {sub.substitute_name}</p>}
                                        </div>
                                        {sub.status === 'Pending Admin' && (
                                          <button className="paw-date-action-cancel" onClick={() => { cancelSubRequest(sub.id); setPawActionModal(null); }}><i className="fas fa-times"></i> Cancel</button>
                                        )}
                                      </div>
                                    )}
                                    {/* Action Buttons */}
                                    <div className="paw-date-action-buttons">
                                      {!exc && (
                                        <button className="paw-date-action-btn excuse" onClick={() => {
                                          setPawActionModal(null);
                                          setExcuseModalDate(pawActionModal.date);
                                          setExcuseModalRoleType(pawActionModal.roleType);
                                          setExcuseReason('');
                                        }}>
                                          <i className="fas fa-calendar-minus"></i>
                                          <div>
                                            <strong>File an Excuse</strong>
                                            <span>Let admin know you can&apos;t make it</span>
                                          </div>
                                        </button>
                                      )}
                                      {!sub && pawActionModal.isAssigned && (
                                        <button className="paw-date-action-btn substitute" onClick={() => {
                                          setPawActionModal(null);
                                          setSubModalDate(pawActionModal.date);
                                          setSubModalScheduleId(null);
                                          setSubModalRoleType(pawActionModal.roleType);
                                          setSubReason('');
                                        }}>
                                          <i className="fas fa-people-arrows"></i>
                                          <div>
                                            <strong>Request Substitute</strong>
                                            <span>Ask someone to cover your role</span>
                                          </div>
                                        </button>
                                      )}
                                      {!sub && !pawActionModal.isAssigned && !exc && (
                                        <p className="paw-date-action-hint"><i className="fas fa-info-circle"></i> Substitute requests are only available for dates where you&apos;re assigned in the lineup.</p>
                                      )}
                                      {exc && sub && (
                                        <p className="paw-date-action-done"><i className="fas fa-check-circle"></i> You have already filed an excuse and a sub request for this date.</p>
                                      )}
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* My Excuse Dates */}
                      {myExcuses.length > 0 && (
                        <div className="paw-quick-history-card" style={{ marginTop: 20 }}>
                          <h4><i className="fas fa-calendar-minus"></i> My Excuses</h4>
                          <div className="paw-quick-history-list">
                            {myExcuses.map(exc => {
                              const isPastExc = new Date(exc.excuse_date + 'T00:00:00') < todayDate;
                              return (
                                <div key={exc.id} className={`paw-quick-history-item ${exc.status.toLowerCase()}${isPastExc ? ' past' : ''}`}>
                                  <span className="paw-quick-history-date">{formatDate(exc.excuse_date)}</span>
                                  <span className={`paw-quick-history-status ${exc.status.toLowerCase()}`}>{exc.status}</span>
                                  <span className="paw-quick-history-reason">{exc.reason}</span>
                                  {exc.status === 'Pending' && !isPastExc && (
                                    <button className="paw-quick-history-cancel" onClick={() => cancelExcuse(exc.id)}><i className="fas fa-times"></i></button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* My Sub Requests */}
                      {mySubs.length > 0 && (
                        <div className="paw-quick-history-card" style={{ marginTop: 12 }}>
                          <h4><i className="fas fa-people-arrows"></i> My Sub Requests</h4>
                          <div className="paw-quick-history-list">
                            {mySubs.map(sub => {
                              const isPastSub = new Date(sub.schedule_date + 'T00:00:00') < todayDate;
                              return (
                                <div key={sub.id} className={`paw-quick-history-item ${sub.status === 'Pending Admin' ? 'pending' : sub.status === 'Open for Sub' ? 'open' : sub.status === 'Accepted' ? 'accepted' : 'default'}${isPastSub ? ' past' : ''}`}>
                                  <span className="paw-quick-history-date">{formatDate(sub.schedule_date)}</span>
                                  <span className={`paw-quick-history-status ${sub.status === 'Pending Admin' ? 'pending' : sub.status.toLowerCase().replace(/ /g, '-')}`}>{sub.status === 'Pending Admin' ? 'Pending' : sub.status}</span>
                                  <span className="paw-quick-history-reason">{sub.reason}</span>
                                  {sub.status === 'Pending Admin' && !isPastSub && (
                                    <button className="paw-quick-history-cancel" onClick={() => cancelSubRequest(sub.id)}><i className="fas fa-times"></i></button>
                                  )}
                                  {sub.status === 'Accepted' && sub.substitute_name && (
                                    <span className="paw-quick-history-sub-name"><i className="fas fa-user-check"></i> {sub.substitute_name}</span>
                                  )}
                                  {sub.status === 'Accepted' && sub.substitute_name && !sub.thank_you_sent && !isPastSub && (
                                    <button className="paw-quick-history-thankyou" onClick={() => { setSubThankYouModal({ subId: sub.id, subName: sub.substitute_name }); setSubThankYouMessage(''); }}>
                                      <i className="fas fa-heart"></i> Thank You
                                    </button>
                                  )}
                                  {sub.thank_you_sent && (
                                    <span className="paw-quick-history-thankyou-sent"><i className="fas fa-heart"></i> Sent</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Open Sub Requests from fellow members — I'll Sub! */}
                      {(() => {
                        const openSubs = getOpenSubsForMe();
                        if (openSubs.length === 0) return null;
                        return (
                          <div className="paw-quick-history-card paw-open-subs-card" style={{ marginTop: 16 }}>
                            <h4 style={{ color: '#9c27b0' }}><i className="fas fa-people-arrows"></i> Open Sub Requests <span className="paw-open-subs-badge">{openSubs.length}</span></h4>
                            <p className="paw-open-subs-hint">A fellow {myRoleLabel} needs a substitute. Can you help?</p>
                            <div className="paw-quick-history-list">
                              {openSubs.map(sub => (
                                <div key={sub.id} className="paw-quick-history-item open" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div className="paw-open-sub-avatar">
                                      {sub.requester_profile_picture ? <img src={sub.requester_profile_picture} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9c27b0' }}>{getInitials(sub.requester_name)}</span>}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <strong style={{ fontSize: '0.85rem', color: '#fff' }}>{sub.requester_name}</strong>
                                      <span className="paw-quick-history-date" style={{ display: 'block', marginTop: 2 }}><i className="fas fa-calendar-day"></i> {formatDate(sub.schedule_date)}</span>
                                    </div>
                                  </div>
                                  <span className="paw-quick-history-reason"><i className="fas fa-quote-left"></i> {sub.reason}</span>
                                  <button className="paw-open-sub-accept-btn" onClick={() => acceptSubRequest(sub.id)}>
                                    <i className="fas fa-check"></i> I&apos;ll Sub!
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            )}
            {pawTab === 'notifications' && (
              <div className="paw-notifications-container">
                {pawNotifications.length === 0 ? (
                  <div className="paw-empty-state">
                    <i className="fas fa-bell-slash"></i>
                    <p>No notifications yet.</p>
                    <span>Lineup assignments and updates will appear here.</span>
                  </div>
                ) : (
                  <div className="paw-notifications-list">
                    {pawNotifications.map((notif, idx) => (
                      <div key={idx} className={`paw-notif-card ${notif.is_read ? 'read' : 'unread'}`}
                        onClick={async () => {
                          if (!notif.is_read) {
                            await fetch('/api/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notif.id }) });
                            loadPawNotifications();
                            loadNotifications(userData?.id);
                          }
                          // If substitute notification, navigate to My Schedule tab to see/act on open subs
                          if (notif.type === 'substitute') {
                            setPawTab('my-schedule');
                            loadPawMySchedules();
                            loadSubRequests();
                          }
                        }}
                      >
                        <div className="paw-notif-icon">
                          <i className={`fas ${notif.type === 'lineup' ? 'fa-music' : notif.type === 'substitute' ? 'fa-people-arrows' : 'fa-bell'}`}></i>
                        </div>
                        <div className="paw-notif-content">
                          <div className="paw-notif-title">{notif.title}</div>
                          <div className="paw-notif-message">{notif.message}</div>
                          <div className="paw-notif-time"><i className="fas fa-clock"></i> {new Date(notif.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                          {notif.type === 'substitute' && notif.title?.includes('Available') && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: '0.75rem', color: '#ce93d8', fontWeight: 600 }}>
                              <i className="fas fa-arrow-right"></i> Tap to view &amp; sub
                            </span>
                          )}
                          {notif.type === 'substitute' && notif.title?.includes('Thank You') && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: '0.75rem', color: '#f0c040', fontWeight: 600 }}>
                              <i className="fas fa-heart"></i> Thank you message received
                            </span>
                          )}
                        </div>
                        {!notif.is_read && <span className="paw-notif-dot"></span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* LYRICS LIBRARY TAB (Multimedia Users) */}
            {pawTab === 'lyrics-library' && isMultimediaUser && (
              <div className="lyrics-lib-container">
                {/* Lyrics Editor Modal */}
                {lyricsEditorOpen && (
                  <div className="um-modal-overlay" onClick={() => setLyricsEditorOpen(false)}>
                    <div className="lyrics-editor-modal" onClick={(e) => e.stopPropagation()}>
                      <div className="lyrics-editor-header">
                        <h3><i className="fas fa-pen-fancy"></i> {lyricsEditorData ? 'Edit Lyrics' : 'Create Lyrics'}</h3>
                        <button className="modal-close-btn" onClick={() => setLyricsEditorOpen(false)}><i className="fas fa-times"></i></button>
                      </div>
                      <div className="lyrics-editor-body">
                        {/* YouTube Link + AI Auto-fill */}
                        <div className="lyrics-editor-yt-row">
                          <div className="lyrics-editor-field" style={{ flex: 1 }}>
                            <label><i className="fab fa-youtube" style={{ color: '#ff0000' }}></i> YouTube Link</label>
                            <input type="text" className="form-control" placeholder="https://youtube.com/watch?v=..." value={lyricsEditorForm.youtube_link} onChange={(e) => setLyricsEditorForm(prev => ({ ...prev, youtube_link: e.target.value }))} />
                          </div>
                          <button className="lyrics-ai-btn" onClick={handleLyricsAiAutofill} disabled={lyricsAiLoading || !lyricsEditorForm.youtube_link}>
                            {lyricsAiLoading ? <><i className="fas fa-spinner fa-spin"></i> AI Working...</> : <><i className="fas fa-magic"></i> AI Auto-Fill</>}
                          </button>
                        </div>

                        {/* Title, Artist, Language */}
                        <div className="lyrics-editor-meta-row">
                          <div className="lyrics-editor-field">
                            <label>Song Title *</label>
                            <input type="text" className="form-control" placeholder="Song title" value={lyricsEditorForm.title} onChange={(e) => setLyricsEditorForm(prev => ({ ...prev, title: e.target.value }))} />
                          </div>
                          <div className="lyrics-editor-field">
                            <label>Artist</label>
                            <input type="text" className="form-control" placeholder="Artist name" value={lyricsEditorForm.artist} onChange={(e) => setLyricsEditorForm(prev => ({ ...prev, artist: e.target.value }))} />
                          </div>
                          <div className="lyrics-editor-field" style={{ maxWidth: 160 }}>
                            <label>Language</label>
                            <select className="form-control" value={lyricsEditorForm.language} onChange={(e) => setLyricsEditorForm(prev => ({ ...prev, language: e.target.value }))}>
                              <option value="English">English</option>
                              <option value="Tagalog">Tagalog</option>
                              <option value="Bisaya">Bisaya</option>
                              <option value="Mixed">Mixed</option>
                            </select>
                          </div>
                        </div>

                        {/* Paste & AI Format Section */}
                        <div className="lyrics-editor-paste-section">
                          <label><i className="fas fa-paste"></i> Paste Lyrics (AI will auto-format into sections)</label>
                          <textarea className="form-control lyrics-paste-area" rows={5} placeholder="Paste raw lyrics here from any website... AI will detect Verse 1, Chorus, Bridge etc." value={lyricsPasteText} onChange={(e) => setLyricsPasteText(e.target.value)} />
                          <button className="lyrics-format-btn" onClick={handleLyricsAiFormat} disabled={lyricsFormatLoading || !lyricsPasteText.trim()}>
                            {lyricsFormatLoading ? <><i className="fas fa-spinner fa-spin"></i> Formatting...</> : <><i className="fas fa-wand-magic-sparkles"></i> AI Format into Sections</>}
                          </button>
                        </div>

                        {/* Section Editor */}
                        <div className="lyrics-sections-editor">
                          <div className="lyrics-sections-header">
                            <h4><i className="fas fa-layer-group"></i> Lyrics Sections</h4>
                            <button className="lyrics-add-section-btn" onClick={addLyricsSection}><i className="fas fa-plus"></i> Add Section</button>
                          </div>
                          {lyricsEditorForm.sections.length === 0 && (
                            <div className="lyrics-no-sections">
                              <i className="fas fa-music"></i>
                              <p>No sections yet. Use AI Auto-Fill, paste lyrics above, or add sections manually.</p>
                            </div>
                          )}
                          {lyricsEditorForm.sections.map((section, idx) => (
                            <div key={idx} className="lyrics-section-card">
                              <div className="lyrics-section-card-header">
                                <select className="lyrics-section-label-select" value={section.label} onChange={(e) => updateLyricsSection(idx, 'label', e.target.value)}>
                                  <option value="Intro">Intro</option>
                                  <option value="Verse 1">Verse 1</option>
                                  <option value="Verse 2">Verse 2</option>
                                  <option value="Verse 3">Verse 3</option>
                                  <option value="Verse 4">Verse 4</option>
                                  <option value="Pre-Chorus">Pre-Chorus</option>
                                  <option value="Chorus">Chorus</option>
                                  <option value="Chorus 2">Chorus 2</option>
                                  <option value="Bridge">Bridge</option>
                                  <option value="Bridge 2">Bridge 2</option>
                                  <option value="Interlude">Interlude</option>
                                  <option value="Outro">Outro</option>
                                  <option value="Tag">Tag</option>
                                  <option value="Refrain">Refrain</option>
                                  <option value="Ad-lib">Ad-lib</option>
                                </select>
                                <div className="lyrics-section-actions">
                                  <button onClick={() => moveLyricsSection(idx, -1)} disabled={idx === 0} title="Move up"><i className="fas fa-arrow-up"></i></button>
                                  <button onClick={() => moveLyricsSection(idx, 1)} disabled={idx === lyricsEditorForm.sections.length - 1} title="Move down"><i className="fas fa-arrow-down"></i></button>
                                  <button onClick={() => removeLyricsSection(idx)} className="lyrics-section-delete" title="Remove"><i className="fas fa-trash"></i></button>
                                </div>
                              </div>
                              <textarea className="form-control lyrics-section-textarea" rows={4} placeholder="Enter lyrics for this section..." value={section.content} onChange={(e) => updateLyricsSection(idx, 'content', e.target.value)} />
                            </div>
                          ))}
                        </div>

                        {/* Preview */}
                        {lyricsEditorForm.sections.length > 0 && (
                          <div className="lyrics-preview-section">
                            <h4><i className="fas fa-eye"></i> Preview</h4>
                            <div className="lyrics-preview-card">
                              {lyricsEditorForm.title && <h3 className="lyrics-preview-title">{lyricsEditorForm.title}</h3>}
                              {lyricsEditorForm.artist && <p className="lyrics-preview-artist">{lyricsEditorForm.artist}</p>}
                              {lyricsEditorForm.sections.map((section, idx) => (
                                <div key={idx} className="lyrics-preview-section-block">
                                  <span className="lyrics-preview-label">[{section.label}]</span>
                                  <pre className="lyrics-preview-content">{section.content}</pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="lyrics-editor-footer">
                        <button className="btn-secondary" onClick={() => setLyricsEditorOpen(false)}>Cancel</button>
                        <button className="btn-primary" onClick={handleLyricsSave} disabled={lyricsEditorLoading || !lyricsEditorForm.title.trim()}>
                          {lyricsEditorLoading ? <><i className="fas fa-spinner fa-spin"></i> Saving...</> : <><i className="fas fa-save"></i> {lyricsEditorData ? 'Update Lyrics' : 'Save to Library'}</>}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Link to Schedule Modal */}
                {lyricsLinkModal && (
                  <div className="um-modal-overlay" onClick={() => setLyricsLinkModal(null)}>
                    <div className="lyrics-link-modal" onClick={(e) => e.stopPropagation()}>
                      <div className="lyrics-editor-header">
                        <h3><i className="fas fa-link"></i> Link to Schedule</h3>
                        <button className="modal-close-btn" onClick={() => setLyricsLinkModal(null)}><i className="fas fa-times"></i></button>
                      </div>
                      <div className="lyrics-link-body">
                        <p className="lyrics-link-desc"><i className="fas fa-info-circle"></i> Select a schedule date to link <strong>&quot;{lyricsLinkModal.lyricsTitle}&quot;</strong> to. Other ministry members will then see &quot;Prepared by Multimedia Team&quot; when viewing the lyrics.</p>
                        <div className="lyrics-link-schedule-list">
                          {multimediaLineupNotifs.length === 0 ? (
                            <div className="lyrics-no-sections"><i className="fas fa-calendar-xmark"></i><p>No upcoming schedules with songs found.</p></div>
                          ) : (
                            multimediaLineupNotifs.map((sched, idx) => (
                              <div key={idx} className="lyrics-link-schedule-card" onClick={() => handleLyricsLinkToSchedule(lyricsLinkModal.lyricsId, sched.scheduleDate)}>
                                <div className="lyrics-link-sched-date">
                                  <span className="lyrics-link-day">{new Date(sched.scheduleDate + 'T00:00:00').getDate()}</span>
                                  <span className="lyrics-link-month">{new Date(sched.scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</span>
                                </div>
                                <div className="lyrics-link-sched-info">
                                  <strong>{sched.songLeader}</strong>
                                  <span>{[...(sched.slowSongs || []), ...(sched.fastSongs || [])].filter(s => s.title).map(s => s.title).join(', ')}</span>
                                </div>
                                <i className="fas fa-arrow-right" style={{ color: '#90caf9' }}></i>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Multimedia Lineup Notifications Banner */}
                {multimediaLineupNotifs.length > 0 && (
                  <div className="lyrics-lineup-banner">
                    <div className="lyrics-lineup-banner-header">
                      <i className="fas fa-music"></i>
                      <h4>🎵 Songs Needing Lyrics <span className="lyrics-lineup-count">{multimediaLineupNotifs.reduce((acc, s) => acc + [...(s.slowSongs || []), ...(s.fastSongs || [])].filter(ss => ss.title).length, 0)}</span></h4>
                    </div>
                    <p className="lyrics-lineup-banner-desc">Song Leaders have added songs to upcoming lineups. Prepare lyrics for the worship team!</p>
                    <div className="lyrics-lineup-items">
                      {multimediaLineupNotifs.map((sched, idx) => {
                        const allSongs = [...(sched.slowSongs || []), ...(sched.fastSongs || [])].filter(s => s.title);
                        return (
                          <div key={idx} className="lyrics-lineup-item">
                            <div className="lyrics-lineup-item-date">
                              <span className="lyrics-lineup-item-day">{new Date(sched.scheduleDate + 'T00:00:00').getDate()}</span>
                              <span className="lyrics-lineup-item-month">{new Date(sched.scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</span>
                            </div>
                            <div className="lyrics-lineup-item-songs">
                              <strong>{sched.songLeader}</strong>
                              <div className="lyrics-lineup-song-chips">
                                {allSongs.map((song, si) => (
                                  <span key={si} className="lyrics-lineup-song-chip" onClick={() => {
                                    openLyricsEditor();
                                    // Split "TITLE - ARTIST" format into separate fields
                                    const songTitleRaw = song.title || '';
                                    let sTitle = songTitleRaw;
                                    let sArtist = '';
                                    if (songTitleRaw.includes(' - ')) {
                                      const parts = songTitleRaw.split(' - ');
                                      sTitle = parts[0].trim();
                                      sArtist = parts.slice(1).join(' - ').trim();
                                    }
                                    setLyricsEditorForm(prev => ({
                                      ...prev,
                                      title: sTitle,
                                      artist: sArtist,
                                      youtube_link: song.link || '',
                                    }));
                                  }}>
                                    <i className="fas fa-music"></i> {song.title}
                                    <i className="fas fa-plus" style={{ marginLeft: 6, fontSize: '0.65rem' }}></i>
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Search & Filter Bar */}
                <div className="lyrics-lib-toolbar">
                  <button className="lyrics-create-btn" onClick={() => openLyricsEditor()}>
                    <i className="fas fa-plus"></i> Create Lyrics
                  </button>
                  <div className="lyrics-search-bar">
                    <i className="fas fa-search"></i>
                    <input type="text" placeholder="Search by title or artist..." value={lyricsSearch} onChange={(e) => setLyricsSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadLyricsLibrary()} />
                  </div>
                  <select className="lyrics-lang-filter" value={lyricsLangFilter} onChange={(e) => { setLyricsLangFilter(e.target.value); setTimeout(loadLyricsLibrary, 100); }}>
                    <option value="All">All Languages</option>
                    <option value="English">🇺🇸 English</option>
                    <option value="Tagalog">🇵🇭 Tagalog</option>
                    <option value="Bisaya">🏝️ Bisaya</option>
                    <option value="Mixed">🌐 Mixed</option>
                  </select>
                </div>

                {/* Lyrics Library Grid */}
                <div className="lyrics-lib-grid">
                  {lyricsLibrary.length === 0 ? (
                    <div className="paw-empty-state">
                      <i className="fas fa-file-audio"></i>
                      <p>No lyrics in library yet.</p>
                      <span>Create your first lyrics entry using the button above!</span>
                    </div>
                  ) : (
                    lyricsLibrary.map((item) => (
                      <div key={item.id} className="lyrics-lib-card">
                        <div className="lyrics-lib-card-header">
                          <div className="lyrics-lib-card-lang" data-lang={item.language}>
                            {item.language === 'English' ? '🇺🇸' : item.language === 'Tagalog' ? '🇵🇭' : item.language === 'Bisaya' ? '🏝️' : '🌐'} {item.language}
                          </div>
                          {item.youtube_link && (
                            <a href={item.youtube_link} target="_blank" rel="noopener noreferrer" className="lyrics-lib-yt-link" onClick={(e) => e.stopPropagation()}>
                              <i className="fab fa-youtube"></i>
                            </a>
                          )}
                        </div>
                        <div className="lyrics-lib-card-body">
                          <h4 className="lyrics-lib-card-title">{item.title}</h4>
                          {item.artist && <p className="lyrics-lib-card-artist"><i className="fas fa-user"></i> {item.artist}</p>}
                          <p className="lyrics-lib-card-preview">{item.lyrics_plain ? item.lyrics_plain.substring(0, 100) + '...' : 'No lyrics content'}</p>
                        </div>
                        <div className="lyrics-lib-card-meta">
                          <span><i className="fas fa-user-pen"></i> {item.prepared_by_name || 'Unknown'}</span>
                          <span><i className="fas fa-clock"></i> {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </div>
                        <div className="lyrics-lib-card-actions">
                          <button className="lyrics-lib-btn edit" onClick={() => openLyricsEditor(item)} title="Edit"><i className="fas fa-edit"></i></button>
                          <button className="lyrics-lib-btn link" onClick={() => setLyricsLinkModal({ lyricsId: item.id, lyricsTitle: item.title })} title="Link to Schedule"><i className="fas fa-link"></i></button>
                          <button className="lyrics-lib-btn view" onClick={() => setPawLyricsModal({ title: item.title, lyrics: item.lyrics_plain, artist: item.artist, loading: false, source: 'multimedia', preparedBy: item.prepared_by_name })} title="View"><i className="fas fa-eye"></i></button>
                          <button className="lyrics-lib-btn delete" onClick={() => handleLyricsDelete(item.id)} title="Delete"><i className="fas fa-trash"></i></button>
                        </div>
                        {item.linked_schedule_dates?.length > 0 && (
                          <div className="lyrics-lib-linked-dates">
                            <i className="fas fa-calendar-check"></i>
                            {item.linked_schedule_dates.map((d, i) => (
                              <span key={i} className="lyrics-lib-linked-chip">{new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>

          {/* PAW Schedule Detail Modal */}
          {pawSelectedSchedule && (
            <div className="paw-detail-modal-overlay" onClick={() => { setPawSelectedSchedule(null); setPawPlayingSong(null); }}>
              <div className="paw-detail-modal paw-detail-modal-v2" onClick={(e) => e.stopPropagation()}>
                <div className="paw-detail-modal-header-v2">
                  <div className="paw-detail-modal-date-strip">
                    <div className="paw-detail-modal-date-big">
                      <span className="paw-detail-modal-day-num">{new Date(pawSelectedSchedule.scheduleDate + 'T00:00:00').getDate()}</span>
                      <div className="paw-detail-modal-month-col">
                        <span>{new Date(pawSelectedSchedule.scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long' })}</span>
                        <span>{new Date(pawSelectedSchedule.scheduleDate + 'T00:00:00').getFullYear()}</span>
                      </div>
                    </div>
                    <span className="paw-detail-modal-weekday">{new Date(pawSelectedSchedule.scheduleDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}</span>
                  </div>
                  <button className="modal-close-btn" onClick={() => { setPawSelectedSchedule(null); setPawPlayingSong(null); }}><i className="fas fa-times"></i></button>
                </div>

                <div className="paw-detail-modal-body-v2">
                  {/* People Section */}
                  <div className="paw-detail-people-section">
                    {/* Song Leader */}
                    <div className="paw-detail-person-card">
                      <div className="paw-detail-person-avatar-wrap">
                        {pawSelectedSchedule.songLeaderPicture ? (
                          <img src={pawSelectedSchedule.songLeaderPicture} alt="" className="paw-detail-person-avatar" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="paw-detail-person-avatar paw-card-v2-avatar-initials">{getInitials(pawSelectedSchedule.songLeader)}</div>
                        )}
                        <span className="paw-detail-person-role-icon"><i className="fas fa-microphone"></i></span>
                      </div>
                      <div className="paw-detail-person-info">
                        <span className="paw-detail-person-role">{pawSelectedSchedule.hasSubstitute ? 'Song Leader (Substitute)' : 'Song Leader'}</span>
                        <span className="paw-detail-person-name">{pawSelectedSchedule.songLeader}</span>
                      </div>
                    </div>

                    {/* Original Song Leader */}
                    {pawSelectedSchedule.hasSubstitute && pawSelectedSchedule.originalSongLeader && (
                      <div className="paw-detail-person-card paw-detail-person-original">
                        <div className="paw-detail-person-avatar-wrap">
                          {pawSelectedSchedule.originalSongLeaderPicture ? (
                            <img src={pawSelectedSchedule.originalSongLeaderPicture} alt="" className="paw-detail-person-avatar" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="paw-detail-person-avatar paw-card-v2-avatar-initials">{getInitials(pawSelectedSchedule.originalSongLeader)}</div>
                          )}
                        </div>
                        <div className="paw-detail-person-info">
                          <span className="paw-detail-person-role">Song Leader</span>
                          <span className="paw-detail-person-name paw-grayed-out">{pawSelectedSchedule.originalSongLeader}</span>
                        </div>
                      </div>
                    )}

                    {/* Backup Singers */}
                    {pawSelectedSchedule.backupSingerProfiles?.length > 0 && (
                      <div className="paw-detail-backups-row">
                        <span className="paw-detail-backups-label"><i className="fas fa-users"></i> Backup Singers</span>
                        <div className="paw-detail-backups-list">
                          {pawSelectedSchedule.backupSingerProfiles.map((bp, i) => (
                            <div key={i} className="paw-detail-backup-chip">
                              {bp.profilePicture ? (
                                <img src={bp.profilePicture} alt="" className="paw-detail-backup-avatar" referrerPolicy="no-referrer" />
                              ) : (
                                <span className="paw-detail-backup-avatar paw-card-v2-avatar-initials">{getInitials(bp.name)}</span>
                              )}
                              <span>{bp.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Practice Date */}
                    {pawSelectedSchedule.practiceDate && (
                      <div className="paw-detail-practice-row">
                        <i className="fas fa-calendar-check"></i>
                        <span>Practice: {new Date(pawSelectedSchedule.practiceDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                    )}
                  </div>

                  {/* Songs Sections */}
                  {pawSelectedSchedule.slowSongs?.length > 0 && (
                    <div className="paw-detail-songs-section-v2">
                      <h4 className="paw-detail-songs-heading"><i className="fas fa-music"></i> Slow Songs</h4>
                      {pawSelectedSchedule.slowSongs.map((song, i) => {
                        const songKey = `slow-${i}`;
                        const vidId = extractYouTubeId(song.link);
                        const isPlaying = pawPlayingSong?.key === songKey;
                        return (
                        <div key={i} className="paw-detail-song-card-v2">
                          <div className="paw-detail-song-header">
                            <p className="paw-detail-song-title-v2"><i className="fas fa-music"></i> {song.title}</p>
                          </div>
                          {song.link && vidId && (
                            <div className="paw-audio-player-row paw-audio-col">
                              <div className="paw-audio-top-row">
                                <button className={`paw-audio-play-btn ${isPlaying ? 'playing' : ''}`} onClick={() => setPawPlayingSong(isPlaying ? null : { key: songKey, videoId: vidId })}>
                                  <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                                </button>
                                <div className="paw-audio-info">
                                  <span className="paw-audio-label">{isPlaying ? 'Now Playing' : 'Play Audio'}</span>
                                  <div className="paw-audio-wave">
                                    {isPlaying && <><span></span><span></span><span></span><span></span><span></span></>}
                                  </div>
                                </div>
                                <button className="paw-lyrics-btn" onClick={() => fetchSongLyrics(song.title, song.link, pawSelectedSchedule.scheduleDate)} title="View Lyrics">
                                  <i className="fas fa-align-left"></i> Lyrics
                                </button>
                              </div>
                              {isPlaying && (
                                <div className="paw-audio-progress-wrap">
                                  <span className="paw-audio-time">{formatPawTime(pawAudioTime.current)}</span>
                                  <div className="paw-audio-progress" onClick={handlePawSeek}>
                                    <div className="paw-audio-progress-fill" style={{ width: `${pawAudioTime.duration ? (pawAudioTime.current / pawAudioTime.duration * 100) : 0}%` }}></div>
                                    <div className="paw-audio-progress-thumb" style={{ left: `${pawAudioTime.duration ? (pawAudioTime.current / pawAudioTime.duration * 100) : 0}%` }}></div>
                                  </div>
                                  <span className="paw-audio-time">{formatPawTime(pawAudioTime.duration)}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {song.link && !vidId && (
                            <div className="paw-audio-player-row">
                              <a href={song.link} target="_blank" rel="noopener noreferrer" className="paw-external-link-btn"><i className="fas fa-external-link-alt"></i> Open Link</a>
                              <button className="paw-lyrics-btn" onClick={() => fetchSongLyrics(song.title, song.link, pawSelectedSchedule.scheduleDate)} title="View Lyrics">
                                <i className="fas fa-align-left"></i> Lyrics
                              </button>
                            </div>
                          )}
                          {!song.link && (
                            <div className="paw-audio-player-row">
                              <button className="paw-lyrics-btn" onClick={() => fetchSongLyrics(song.title, null, pawSelectedSchedule.scheduleDate)} title="View Lyrics">
                                <i className="fas fa-align-left"></i> Lyrics
                              </button>
                            </div>
                          )}
                          {song.instructions && <p className="paw-song-instructions-v2"><i className="fas fa-info-circle"></i> {song.instructions}</p>}
                        </div>
                        );
                      })}
                    </div>
                  )}
                  {pawSelectedSchedule.fastSongs?.length > 0 && (
                    <div className="paw-detail-songs-section-v2">
                      <h4 className="paw-detail-songs-heading"><i className="fas fa-bolt"></i> Fast Songs</h4>
                      {pawSelectedSchedule.fastSongs.map((song, i) => {
                        const songKey = `fast-${i}`;
                        const vidId = extractYouTubeId(song.link);
                        const isPlaying = pawPlayingSong?.key === songKey;
                        return (
                        <div key={i} className="paw-detail-song-card-v2">
                          <div className="paw-detail-song-header">
                            <p className="paw-detail-song-title-v2"><i className="fas fa-bolt"></i> {song.title}</p>
                          </div>
                          {song.link && vidId && (
                            <div className="paw-audio-player-row paw-audio-col">
                              <div className="paw-audio-top-row">
                                <button className={`paw-audio-play-btn ${isPlaying ? 'playing' : ''}`} onClick={() => setPawPlayingSong(isPlaying ? null : { key: songKey, videoId: vidId })}>
                                  <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                                </button>
                                <div className="paw-audio-info">
                                  <span className="paw-audio-label">{isPlaying ? 'Now Playing' : 'Play Audio'}</span>
                                  <div className="paw-audio-wave">
                                    {isPlaying && <><span></span><span></span><span></span><span></span><span></span></>}
                                  </div>
                                </div>
                                <button className="paw-lyrics-btn" onClick={() => fetchSongLyrics(song.title, song.link, pawSelectedSchedule.scheduleDate)} title="View Lyrics">
                                  <i className="fas fa-align-left"></i> Lyrics
                                </button>
                              </div>
                              {isPlaying && (
                                <div className="paw-audio-progress-wrap">
                                  <span className="paw-audio-time">{formatPawTime(pawAudioTime.current)}</span>
                                  <div className="paw-audio-progress" onClick={handlePawSeek}>
                                    <div className="paw-audio-progress-fill" style={{ width: `${pawAudioTime.duration ? (pawAudioTime.current / pawAudioTime.duration * 100) : 0}%` }}></div>
                                    <div className="paw-audio-progress-thumb" style={{ left: `${pawAudioTime.duration ? (pawAudioTime.current / pawAudioTime.duration * 100) : 0}%` }}></div>
                                  </div>
                                  <span className="paw-audio-time">{formatPawTime(pawAudioTime.duration)}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {song.link && !vidId && (
                            <div className="paw-audio-player-row">
                              <a href={song.link} target="_blank" rel="noopener noreferrer" className="paw-external-link-btn"><i className="fas fa-external-link-alt"></i> Open Link</a>
                              <button className="paw-lyrics-btn" onClick={() => fetchSongLyrics(song.title, song.link, pawSelectedSchedule.scheduleDate)} title="View Lyrics">
                                <i className="fas fa-align-left"></i> Lyrics
                              </button>
                            </div>
                          )}
                          {!song.link && (
                            <div className="paw-audio-player-row">
                              <button className="paw-lyrics-btn" onClick={() => fetchSongLyrics(song.title, null, pawSelectedSchedule.scheduleDate)} title="View Lyrics">
                                <i className="fas fa-align-left"></i> Lyrics
                              </button>
                            </div>
                          )}
                          {song.instructions && <p className="paw-song-instructions-v2"><i className="fas fa-info-circle"></i> {song.instructions}</p>}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Hidden YouTube Player Container */}
          <div id="paw-yt-player-wrapper" style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            <div id="paw-yt-player-el"></div>
          </div>

          {/* PAW Lyrics Popup Modal */}
          {pawLyricsModal && (
            <div className="paw-lyrics-modal-overlay" onClick={() => setPawLyricsModal(null)}>
              <div className="paw-lyrics-modal" onClick={(e) => e.stopPropagation()}>
                <div className="paw-lyrics-modal-header">
                  <div className="paw-lyrics-modal-title-row">
                    <div className="paw-lyrics-modal-icon"><i className="fas fa-music"></i></div>
                    <div>
                      <h3>{pawLyricsModal.title || 'Song Lyrics'}</h3>
                      {pawLyricsModal.artist && <span className="paw-lyrics-modal-artist">{pawLyricsModal.artist}</span>}
                    </div>
                  </div>
                  <button className="modal-close-btn" onClick={() => setPawLyricsModal(null)}><i className="fas fa-times"></i></button>
                </div>
                <div className="paw-lyrics-modal-body">
                  {pawLyricsModal.loading ? (
                    <div className="paw-lyrics-loading">
                      <i className="fas fa-spinner fa-spin"></i>
                      <p>Fetching lyrics...</p>
                    </div>
                  ) : pawLyricsModal.lyrics ? (
                    <pre className="paw-lyrics-text">{pawLyricsModal.lyrics}</pre>
                  ) : (
                    <div className="paw-lyrics-not-found">
                      <i className="fas fa-search"></i>
                      <p>No lyrics found for this song.</p>
                      <span>Try searching with the exact song title and artist (e.g. &quot;Joy - Planetshakers&quot;).</span>
                    </div>
                  )}
                </div>
                <div className="paw-lyrics-modal-footer">
                  {pawLyricsModal.source === 'multimedia' ? (
                    <div className="paw-lyrics-source-multimedia-badge">
                      <i className="fas fa-desktop"></i>
                      <span>Prepared by: <strong>{pawLyricsModal.preparedBy || 'Multimedia Team'}</strong></span>
                      <span className="paw-lyrics-mm-tag">Media Ministry</span>
                    </div>
                  ) : (
                    <span className="paw-lyrics-source-text"><i className="fas fa-robot"></i> Lyrics powered by AI</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========== GLOBAL EXCUSE / SUBSTITUTE / THANK YOU MODALS ========== */}
          {/* Excuse Modal (Global – accessible from all PAW roles) */}
          {excuseModalDate && (
            <div className="um-modal-overlay" onClick={() => { setExcuseModalDate(null); setExcuseModalRoleType(null); }}>
              <div className="lu-excuse-modal" onClick={(e) => e.stopPropagation()}>
                <div className="lu-excuse-modal-header">
                  <h3><i className="fas fa-calendar-minus"></i> File an Excuse</h3>
                  <button className="btn-close-modal" onClick={() => { setExcuseModalDate(null); setExcuseModalRoleType(null); }}><i className="fas fa-times"></i></button>
                </div>
                <div className="lu-excuse-modal-body">
                  {excuseModalRoleType && (
                    <div className="lu-excuse-role-badge" style={{ background: excuseModalRoleType === 'Backup Singer' ? '#17a2b8' : excuseModalRoleType === 'Instrumentalist' ? '#6f42c1' : excuseModalRoleType === 'Dancer' ? '#e83e8c' : '#926c15', color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <i className={`fas ${excuseModalRoleType === 'Backup Singer' ? 'fa-users' : excuseModalRoleType === 'Instrumentalist' ? 'fa-guitar' : excuseModalRoleType === 'Dancer' ? 'fa-shoe-prints' : 'fa-microphone'}`}></i>
                      {excuseModalRoleType}
                    </div>
                  )}
                  <div className="lu-excuse-date-display">
                    <i className="fas fa-calendar-day"></i>
                    <span>{formatDate(excuseModalDate)}</span>
                  </div>
                  {getMyExcuseForDate(excuseModalDate) ? (
                    <div className="lu-excuse-already">
                      <i className="fas fa-info-circle"></i>
                      <p>You already have an excuse for this date ({getMyExcuseForDate(excuseModalDate).status}).</p>
                    </div>
                  ) : (
                    <>
                      <label className="lu-excuse-label">Reason for excuse <span>*</span></label>
                      <textarea className="form-control lu-excuse-textarea" rows={3} value={excuseReason} onChange={(e) => setExcuseReason(e.target.value)} placeholder="e.g., Family event, out of town, medical appointment..." />
                      <p className="lu-excuse-note"><i className="fas fa-info-circle"></i> Your excuse will be marked as <strong>Pending</strong> until the Admin reviews and approves it.</p>
                    </>
                  )}
                </div>
                {!getMyExcuseForDate(excuseModalDate) && (
                  <div className="lu-excuse-modal-footer">
                    <button className="btn-secondary" onClick={() => { setExcuseModalDate(null); setExcuseModalRoleType(null); }}>Cancel</button>
                    <button className="btn-primary" onClick={() => submitExcuse()} disabled={excuseLoading || !excuseReason.trim()}>
                      {excuseLoading ? <><div className="spinner" style={{ display: 'inline-block', width: 16, height: 16, marginRight: 6 }}></div> Submitting...</> : <><i className="fas fa-paper-plane"></i> Submit Excuse</>}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Substitute Request Modal (Global – accessible from all PAW roles) */}
          {subModalDate && (
            <div className="um-modal-overlay" onClick={() => { setSubModalDate(null); setSubModalRoleType(null); }}>
              <div className="lu-excuse-modal lu-sub-modal" onClick={(e) => e.stopPropagation()}>
                <div className="lu-excuse-modal-header lu-sub-modal-header">
                  <h3><i className="fas fa-people-arrows"></i> Request Substitute</h3>
                  <button className="btn-close-modal" onClick={() => { setSubModalDate(null); setSubModalRoleType(null); }}><i className="fas fa-times"></i></button>
                </div>
                <div className="lu-excuse-modal-body">
                  {subModalRoleType && (
                    <div className="lu-excuse-role-badge" style={{ background: subModalRoleType === 'Backup Singer' ? '#17a2b8' : subModalRoleType === 'Instrumentalist' ? '#6f42c1' : subModalRoleType === 'Dancer' ? '#e83e8c' : '#926c15', color: '#fff', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <i className={`fas ${subModalRoleType === 'Backup Singer' ? 'fa-users' : subModalRoleType === 'Instrumentalist' ? 'fa-guitar' : subModalRoleType === 'Dancer' ? 'fa-shoe-prints' : 'fa-microphone'}`}></i>
                      {subModalRoleType}
                    </div>
                  )}
                  <div className="lu-excuse-date-display">
                    <i className="fas fa-calendar-day"></i>
                    <span>{formatDate(subModalDate)}</span>
                  </div>
                  <p className="lu-sub-modal-desc">
                    <i className="fas fa-info-circle"></i> Your request will go to the Admin for approval. Once approved, all {subModalRoleType === 'Backup Singer' ? 'Backup Singers' : subModalRoleType === 'Instrumentalist' ? 'Instrumentalists' : subModalRoleType === 'Dancer' ? 'Dancers' : 'Song Leaders'} will be notified and can volunteer to substitute for you.
                  </p>
                  <label className="lu-excuse-label">Reason for substitute request <span>*</span></label>
                  <textarea className="form-control lu-excuse-textarea" rows={3} value={subReason} onChange={(e) => setSubReason(e.target.value)} placeholder="e.g., I'll be out of town, family commitment, not feeling well..." />
                </div>
                <div className="lu-excuse-modal-footer">
                  <button className="btn-secondary" onClick={() => { setSubModalDate(null); setSubModalRoleType(null); }}>Cancel</button>
                  <button className="btn-primary lu-sub-submit-btn" onClick={submitSubRequest} disabled={subLoading || !subReason.trim()}>
                    {subLoading ? <><div className="spinner" style={{ display: 'inline-block', width: 16, height: 16, marginRight: 6 }}></div> Submitting...</> : <><i className="fas fa-paper-plane"></i> Submit Request</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Thank You Modal (Global) */}
          {subThankYouModal && (
            <div className="um-modal-overlay" onClick={() => setSubThankYouModal(null)}>
              <div className="lu-excuse-modal lu-thankyou-modal" onClick={(e) => e.stopPropagation()}>
                <div className="lu-excuse-modal-header lu-thankyou-modal-header">
                  <h3><i className="fas fa-heart"></i> Send Thank You</h3>
                  <button className="btn-close-modal" onClick={() => setSubThankYouModal(null)}><i className="fas fa-times"></i></button>
                </div>
                <div className="lu-excuse-modal-body">
                  <div className="lu-thankyou-to">
                    <i className="fas fa-user"></i>
                    <span>To: <strong>{subThankYouModal.subName}</strong></span>
                  </div>
                  <label className="lu-excuse-label">Your message (optional)</label>
                  <textarea className="form-control lu-excuse-textarea" rows={3} value={subThankYouMessage} onChange={(e) => setSubThankYouMessage(e.target.value)} placeholder="Thank you for substituting! God bless you! 🙏" />
                </div>
                <div className="lu-excuse-modal-footer">
                  <button className="btn-secondary" onClick={() => setSubThankYouModal(null)}>Cancel</button>
                  <button className="btn-primary lu-thankyou-send-btn" onClick={sendSubThankYou}>
                    <i className="fas fa-heart"></i> Send Thank You 💛
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========== LINEUP SECTION (Merged: Assign + All Assignments) ========== */}
          {canManage(MODULES.CREATE_SONG_LIST) && (
            <section className={`content-section ${activeSection === 'create-lineup' ? 'active' : ''}`}>
              {/* Tab Switcher */}
              <div className="lu-tab-bar">
                <button className={`lu-tab ${lineupTab === 'assign' ? 'active' : ''}`} onClick={() => { setLineupTab('assign'); if (lineupTab !== 'assign') { resetLineupForm(); } }}>
                  <i className="fas fa-music"></i> {isAdmin ? 'Assign Lineup' : 'Create Lineup'}
                  {isAdmin && (getPendingAdminSubs().length > 0) && <span className="lu-tab-badge">{getPendingAdminSubs().length}</span>}
                  {!isAdmin && getOpenSubsForMe().length > 0 && <span className="lu-tab-badge sub">{getOpenSubsForMe().length}</span>}
                </button>
                <button className={`lu-tab ${lineupTab === 'all' ? 'active' : ''}`} onClick={() => { setLineupTab('all'); loadScheduleData(); }}>
                  <i className="fas fa-list-ol"></i> {isAdmin ? 'All Assignments' : 'My Lineups'}
                </button>
                <button className={`lu-tab ${lineupTab === 'paw-logs' ? 'active' : ''}`} onClick={() => { setLineupTab('paw-logs'); loadLineupExcuses(); loadSubRequests(); if (isAdmin) loadPawMembers(); }}>
                  <i className={`fas ${isAdmin ? 'fa-clipboard-list' : 'fa-history'}`}></i> {isAdmin ? 'PAW Logs' : 'Excuse History'}
                  {isAdmin && (getPendingExcuses().length + getPendingAdminSubs().length) > 0 && <span className="lu-tab-badge">{getPendingExcuses().length + getPendingAdminSubs().length}</span>}
                </button>
              </div>

              {/* ===== ASSIGN TAB ===== */}
              {lineupTab === 'assign' && (
                <>
                  {/* SUCCESS VIEW */}
                  {lineupView === 'success' && (
                    <div className="lineup-success-container">
                      <div className="lineup-success-icon"><i className="fas fa-check-circle"></i></div>
                      <h3>{isAdmin ? (editingLineup ? 'Assignment Updated!' : 'Lineup Assigned!') : (editingLineup ? 'Songs Updated!' : 'Songs Submitted!')}</h3>
                      <p>{isAdmin ? <>Song Leader and Backup Singers have been {editingLineup ? 'updated' : 'assigned'} for <strong>{formatDate(lineupForm.scheduleDate)}</strong>. The Song Leader will be notified.</> : <>Your songs for <strong>{formatDate(lineupForm.scheduleDate)}</strong> have been {editingLineup ? 'updated' : 'saved'}.</>}</p>
                      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
                        <button className="btn-primary" onClick={resetLineupForm} style={{ padding: '12px 30px' }}><i className="fas fa-plus"></i> {isAdmin ? 'Assign Another' : 'Back to Calendar'}</button>
                        <button className="btn-secondary" onClick={() => { resetLineupForm(); setLineupTab('all'); }} style={{ padding: '12px 30px' }}><i className="fas fa-list-ol"></i> View All</button>
                      </div>
                    </div>
                  )}

                  {/* ADMIN PENDING EXCUSE NOTIFICATIONS */}
                  {lineupView !== 'success' && isAdmin && getPendingExcuses().length > 0 && (
                    <div className="lu-excuse-admin-card">
                      <div className="lu-excuse-admin-header">
                        <i className="fas fa-bell"></i>
                        <span>Pending Excuse Requests <span className="lu-excuse-admin-badge">{getPendingExcuses().length}</span></span>
                      </div>
                      <div className="lu-excuse-admin-body">
                        {getPendingExcuses().map(exc => (
                          <div key={exc.id} className="lu-excuse-admin-item">
                            <div className="lu-excuse-admin-item-info">
                              <strong>{exc.user_name}</strong>
                              <span className="lu-excuse-admin-date"><i className="fas fa-calendar-day"></i> {formatDate(exc.excuse_date)}</span>
                              <p className="lu-excuse-admin-reason"><i className="fas fa-quote-left"></i> {exc.reason}</p>
                            </div>
                            <div className="lu-excuse-admin-actions">
                              <button className="btn-small btn-success" onClick={() => reviewExcuse(exc.id, 'Approved')} title="Approve"><i className="fas fa-check"></i></button>
                              <button className="btn-small btn-danger" onClick={() => reviewExcuse(exc.id, 'Rejected')} title="Reject"><i className="fas fa-times"></i></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ADMIN PENDING SUBSTITUTE REQUESTS */}
                  {lineupView !== 'success' && isAdmin && getPendingAdminSubs().length > 0 && (
                    <div className="lu-excuse-admin-card lu-sub-admin-card">
                      <div className="lu-excuse-admin-header lu-sub-admin-header">
                        <i className="fas fa-people-arrows"></i>
                        <span>Pending Substitute Requests <span className="lu-excuse-admin-badge">{getPendingAdminSubs().length}</span></span>
                      </div>
                      <div className="lu-excuse-admin-body">
                        {getPendingAdminSubs().map(sub => (
                          <div key={sub.id} className="lu-excuse-admin-item lu-sub-admin-item">
                            <div className="lu-sub-admin-profile">
                              <div className="lu-sub-admin-avatar">
                                {sub.requester_profile_picture ? <img src={sub.requester_profile_picture} alt="" referrerPolicy="no-referrer" /> : <span>{getInitials(sub.requester_name)}</span>}
                              </div>
                              <div className="lu-excuse-admin-item-info">
                                <strong>{sub.requester_name}</strong>
                                <span className="lu-sub-admin-role-badge" style={{ background: (sub.role_type || 'Song Leader') === 'Song Leader' ? 'rgba(146,108,21,0.15)' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? 'rgba(23,162,184,0.15)' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? 'rgba(111,66,193,0.15)' : 'rgba(232,62,140,0.15)', color: (sub.role_type || 'Song Leader') === 'Song Leader' ? '#926c15' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? '#17a2b8' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? '#6f42c1' : '#e83e8c' }}>
                                  <i className={`fas ${(sub.role_type || 'Song Leader') === 'Song Leader' ? 'fa-microphone' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? 'fa-users' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? 'fa-guitar' : 'fa-shoe-prints'}`}></i> {sub.role_type || 'Song Leader'}
                                </span>
                                <span className="lu-excuse-admin-date"><i className="fas fa-calendar-day"></i> {formatDate(sub.schedule_date)}</span>
                                <p className="lu-excuse-admin-reason"><i className="fas fa-quote-left"></i> {sub.reason}</p>
                              </div>
                            </div>
                            <div className="lu-excuse-admin-actions">
                              <button className="btn-small btn-success" onClick={() => adminReviewSub(sub.id, 'approve')} title={`Approve & Notify All ${(sub.role_type || 'Song Leader') === 'Song Leader' ? 'Song Leaders' : (sub.role_type || 'Song Leader') + 's'}`}><i className="fas fa-check"></i></button>
                              <button className="btn-small btn-danger" onClick={() => adminReviewSub(sub.id, 'reject')} title="Reject"><i className="fas fa-times"></i></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* CALENDAR + FORM SIDE BY SIDE (Admin) */}
                  {lineupView !== 'success' && isAdmin && (
                    <div className="lu-split-layout">
                      {/* LEFT: Calendar */}
                      <div className="lu-split-left">
                        <div className="lineup-calendar-info">
                          <i className="fas fa-info-circle"></i>
                          <span>Select a date to assign a Song Leader and Backup Singers</span>
                        </div>
                        <div className="lineup-calendar-card">
                          <div className="lineup-cal-header">
                            <button onClick={() => setLineupCalendarMonth(new Date(lineupCalendarMonth.getFullYear(), lineupCalendarMonth.getMonth() - 1))}><i className="fas fa-chevron-left"></i></button>
                            <h3>{lineupCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                            <button onClick={() => setLineupCalendarMonth(new Date(lineupCalendarMonth.getFullYear(), lineupCalendarMonth.getMonth() + 1))}><i className="fas fa-chevron-right"></i></button>
                          </div>
                          <div className="lineup-cal-weekdays">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="lineup-cal-weekday">{d}</div>)}
                          </div>
                          <div className="lineup-cal-grid">
                            {getLineupCalendarDays().map((day, i) => {
                              const taken = isLineupDateTaken(day);
                              const past = isLineupDatePast(day);
                              const today = day && new Date().getDate() === day && new Date().getMonth() === lineupCalendarMonth.getMonth() && new Date().getFullYear() === lineupCalendarMonth.getFullYear();
                              const dateStr = day ? `${lineupCalendarMonth.getFullYear()}-${String(lineupCalendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                              const schedule = day && taken ? scheduleData.find(s => s.scheduleDate === dateStr) : null;
                              const leaderName = schedule ? schedule.songLeader : '';
                              const leaderFirstName = leaderName ? leaderName.split(' ')[0] : '';
                              const isSelected = dateStr === lineupSelectedDate;
                              const hasSub = schedule?.hasSubstitute;
                              return (
                                <div key={i} className={`lineup-cal-day${!day ? ' empty' : ''}${taken ? ' admin-taken' : ''}${past ? ' past' : ''}${today ? ' today' : ''}${isSelected ? ' selected' : ''}${hasSub ? ' has-sub' : ''}`}
                                  onClick={() => { if (!day || past || taken) return; handleLineupDateSelect(dateStr); }}
                                  title={hasSub ? `${leaderName} (original: ${schedule.originalSongLeader})` : taken ? `Assigned to ${leaderName}` : past ? 'Past date' : 'Click to assign'}>
                                  {day && <span className="lineup-cal-day-num">{day}</span>}
                                  {taken && day && leaderFirstName && <span className="lineup-cal-leader-name">{leaderFirstName}</span>}
                                  {hasSub && day && <span className="lineup-cal-sub-dot" title="Substituted"><i className="fas fa-people-arrows"></i></span>}
                                </div>
                              );
                            })}
                          </div>
                          <div className="lineup-cal-legend">
                            <span><span className="legend-dot available"></span> Available</span>
                            <span><span className="legend-dot" style={{ background: '#bbb' }}></span> Assigned</span>
                            <span><span className="legend-dot" style={{ background: '#9c27b0' }}></span> Substituted</span>
                            <span><span className="legend-dot past"></span> Past Date</span>
                          </div>
                        </div>
                      </div>

                      {/* RIGHT: Assignment Form Card */}
                      <div className="lu-split-right">
                        {!lineupSelectedDate && !editingLineup ? (
                          <div className="lu-empty-right">
                            <i className="fas fa-hand-pointer"></i>
                            <h4>Select a Date</h4>
                            <p>Click an available date on the calendar to start assigning a Song Leader and Backup Singers.</p>
                          </div>
                        ) : (
                          <div className="lu-assign-card">
                            <div className="lu-assign-card-header">
                              <div className="lu-assign-date-info">
                                <i className="fas fa-calendar-check"></i>
                                <div>
                                  <span className="lu-assign-date-label">Schedule Date</span>
                                  <span className="lu-assign-date-value">{formatDate(lineupForm.scheduleDate)}</span>
                                </div>
                              </div>
                              {!editingLineup && <button className="lu-change-date-btn" onClick={() => setLineupSelectedDate(null)}><i className="fas fa-times"></i></button>}
                            </div>

                            <div className="lu-assign-card-body">
                              {/* Song Leader Dropdown with profiles */}
                              <div className="lu-field-group">
                                <label><i className="fas fa-microphone"></i> Song Leader</label>
                                <div className="lu-profile-select-wrapper">
                                  <select className="form-select lu-profile-select" value={lineupForm.songLeader} onChange={(e) => handleSongLeaderChange(e.target.value)}>
                                    <option value="">-- Select Song Leader --</option>
                                    {songLeaderOptions.map((sl) => {
                                      const excuse = lineupForm.scheduleDate ? getExcuseForLeaderOnDate(sl.name, lineupForm.scheduleDate) : null;
                                      const isExcused = !!excuse;
                                      return <option key={sl.id} value={sl.name} disabled={isExcused} style={isExcused ? { color: '#999' } : {}}>{sl.name}{isExcused ? ` ⛔ (Excused – ${excuse.status})` : ''}</option>;
                                    })}
                                  </select>
                                  {lineupForm.songLeader && (() => { const sl = songLeaderOptions.find(o => o.name === lineupForm.songLeader); const excuse = lineupForm.scheduleDate ? getExcuseForLeaderOnDate(sl?.name, lineupForm.scheduleDate) : null; return sl ? (
                                    <div className={`lu-selected-user-chip${excuse ? ' excused' : ''}`}>
                                      <div className="lu-chip-avatar">{sl.profile_picture ? <img src={sl.profile_picture} alt="" /> : <span>{sl.name.split(' ').map(n => n[0]).join('')}</span>}</div>
                                      <span>{sl.name}</span>
                                      {excuse && <span className="lu-excused-tag"><i className="fas fa-ban"></i> {excuse.status}</span>}
                                    </div>
                                  ) : null; })()}
                                </div>
                                {lineupForm.scheduleDate && songLeaderOptions.some(sl => getExcuseForLeaderOnDate(sl.name, lineupForm.scheduleDate)) && (
                                  <p className="lu-field-hint excuse-hint"><i className="fas fa-info-circle"></i> Grayed out leaders have filed an excuse for this date.</p>
                                )}
                                {songLeaderOptions.length === 0 && <p className="lu-field-hint"><i className="fas fa-info-circle"></i> No Song Leaders found. Assign users with Ministry: Praise And Worship, Sub Role: Song Leaders.</p>}
                              </div>

                              {/* Backup Singers — single dropdown + chips */}
                              <div className="lu-field-group">
                                <label><i className="fas fa-users"></i> Backup Singers</label>
                                {backupSingerOptions.length === 0 && <p className="lu-field-hint"><i className="fas fa-info-circle"></i> No Backup Singers found. Assign users with Ministry: Praise And Worship, Sub Role: Backup Singer.</p>}
                                
                                {/* Selected backup singers as chips */}
                                {lineupForm.backupSingers.filter(Boolean).length > 0 && (
                                  <div className="lu-backup-chips">
                                    {lineupForm.backupSingers.filter(Boolean).map((singer) => {
                                      const bo = backupSingerOptions.find(o => o.name === singer);
                                      const bsExcuse = lineupForm.scheduleDate ? getExcuseForMemberOnDate(singer, lineupForm.scheduleDate, 'Backup Singer') : null;
                                      return (
                                        <div key={singer} className={`lu-backup-chip${bsExcuse ? ' excused' : ''}`}>
                                          <div className="lu-chip-avatar small">{bo?.profile_picture ? <img src={bo.profile_picture} alt="" /> : <span>{singer.split(' ').map(n => n[0]).join('')}</span>}</div>
                                          <span>{singer}</span>
                                          {bsExcuse && <span className="lu-excused-tag"><i className="fas fa-ban"></i> {bsExcuse.status}</span>}
                                          <button className="lu-chip-remove" onClick={() => removeBackupSinger(singer)}><i className="fas fa-times"></i></button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                
                                {/* Dropdown to add more (only shows un-selected singers, excludes song leader) */}
                                {(() => {
                                  const available = getAvailableBackupSingers();
                                  const selected = lineupForm.backupSingers.filter(Boolean);
                                  const excusedSingers = lineupForm.scheduleDate ? backupSingerOptions.filter(b => !selected.includes(b.name) && b.name !== lineupForm.songLeader && getExcuseForMemberOnDate(b.name, lineupForm.scheduleDate, 'Backup Singer')) : [];
                                  return (
                                    <>
                                      {(available.length > 0 || excusedSingers.length > 0) && selected.length < 5 && (
                                        <select className="form-select lu-add-backup-select" value="" onChange={(e) => { addBackupSingerByName(e.target.value); }}>
                                          <option value="">+ Add Backup Singer</option>
                                          {available.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                                          {excusedSingers.map((b) => {
                                            const exc = getExcuseForMemberOnDate(b.name, lineupForm.scheduleDate, 'Backup Singer');
                                            return <option key={b.id} value={b.name} disabled style={{ color: '#999' }}>{b.name} ⛔ (Excused – {exc?.status})</option>;
                                          })}
                                        </select>
                                      )}
                                      {available.length === 0 && excusedSingers.length === 0 && selected.length > 0 && backupSingerOptions.length > 0 && (
                                        <p className="lu-field-hint"><i className="fas fa-check-circle" style={{color: 'var(--primary)'}}></i> All available backup singers have been added.</p>
                                      )}
                                      {excusedSingers.length > 0 && (
                                        <p className="lu-field-hint excuse-hint"><i className="fas fa-info-circle"></i> Grayed out singers have filed an excuse for this date.</p>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </div>

                            <div className="lu-assign-card-footer">
                              <button className="btn-secondary" onClick={resetLineupForm}><i className="fas fa-times"></i> Cancel</button>
                              <button className="btn-primary" onClick={submitLineup} disabled={lineupLoading}>
                                {lineupLoading ? <><div className="spinner" style={{ display: 'inline-block', width: 18, height: 18, marginRight: 8 }}></div> Saving...</> : <><i className="fas fa-user-check"></i> {editingLineup ? 'Update' : 'Assign Lineup'}</>}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* SONG LEADER CALENDAR VIEW (non-admin) — 2-col: calendar + info cards */}
                  {lineupView === 'calendar' && !isAdmin && (
                    <div className="lu-sl-layout">
                      {/* LEFT: Calendar */}
                      <div className="lu-sl-calendar">
                        <div className="lineup-calendar-info">
                          <i className="fas fa-info-circle"></i>
                          <span>Tap your assigned date to add songs. Tap a free date to file an excuse.</span>
                        </div>

                        <div className="lineup-calendar-card">
                          <div className="lineup-cal-header">
                            <button onClick={() => setLineupCalendarMonth(new Date(lineupCalendarMonth.getFullYear(), lineupCalendarMonth.getMonth() - 1))}><i className="fas fa-chevron-left"></i></button>
                            <h3>{lineupCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                            <button onClick={() => setLineupCalendarMonth(new Date(lineupCalendarMonth.getFullYear(), lineupCalendarMonth.getMonth() + 1))}><i className="fas fa-chevron-right"></i></button>
                          </div>
                          <div className="lineup-cal-weekdays">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="lineup-cal-weekday">{d}</div>)}
                          </div>
                          <div className="lineup-cal-grid">
                            {getLineupCalendarDays().map((day, i) => {
                              const taken = isLineupDateTaken(day);
                              const past = isLineupDatePast(day);
                              const today = day && new Date().getDate() === day && new Date().getMonth() === lineupCalendarMonth.getMonth() && new Date().getFullYear() === lineupCalendarMonth.getFullYear();
                              const dateStr = day ? `${lineupCalendarMonth.getFullYear()}-${String(lineupCalendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                              const schedule = day && taken ? scheduleData.find(s => s.scheduleDate === dateStr) : null;
                              const leaderName = schedule ? schedule.songLeader : '';
                              const leaderFirstName = leaderName ? leaderName.split(' ')[0] : '';
                              const assigned = day && getAssignedDates().includes(dateStr);
                              const assignedAndPast = assigned && past;
                              const assignedAndFuture = assigned && !past;
                              const slViewable = day && taken && !assigned;
                              const myExcuse = day && !past ? getMyExcuseForDate(dateStr) : null;
                              const hasExcuse = !!myExcuse;
                              const mySub = day ? getSubForDate(dateStr) : null;
                              const hasSub = !!mySub;
                              const subAccepted = hasSub && mySub.status === 'Accepted';
                              const isMySubDate = day && isSubstituteDateForMe(dateStr);
                              const isMySubDateFuture = isMySubDate && !past;
                              return (
                                <div key={i} className={`lineup-cal-day${!day ? ' empty' : ''}${!isAdmin && taken && !assigned && !isMySubDate ? ' taken' : ''}${past ? ' past' : ''}${today ? ' today' : ''}${assignedAndFuture && !subAccepted ? ' assigned' : ''}${assignedAndPast ? ' assigned-past' : ''}${slViewable && !isMySubDate ? ' viewable' : ''}${hasExcuse ? ' excused' : ''}${subAccepted ? ' sub-excused' : ''}${isMySubDateFuture ? ' sub-assigned' : ''}`}
                                  onClick={() => {
                                    if (!day) return;
                                    if (past && !isMySubDate && !assigned && !subAccepted) return;
                                    if (assignedAndPast && !subAccepted) { showToast('This date has already passed.', 'warning'); return; }
                                    if (subAccepted) { handleLineupDateSelect(dateStr); return; }
                                    if (isMySubDateFuture) { handleLineupDateSelect(dateStr); return; }
                                    if (taken) { handleLineupDateSelect(dateStr); return; }
                                    if (!past && !taken) { setExcuseModalDate(dateStr); setExcuseModalRoleType('Song Leader'); setExcuseReason(''); return; }
                                  }}
                                  title={isMySubDateFuture ? 'You\'re substituting — click to add songs' : subAccepted ? `Excused — Substituted by ${mySub.substitute_name}` : assignedAndFuture ? 'Your assigned date — click to add songs' : assignedAndPast ? 'Past assigned date' : slViewable ? `Assigned to ${leaderName} — click to view` : hasExcuse ? `Excused (${myExcuse.status})` : past ? 'Past date' : 'Click to file an excuse'}>
                                  {day && <span className="lineup-cal-day-num">{day}</span>}
                                  {subAccepted && day && <span className="lineup-cal-leader-name sub-label">{mySub.substitute_name?.split(' ')[0]}</span>}
                                  {taken && day && leaderFirstName && !isMySubDate && !subAccepted && <span className="lineup-cal-leader-name">{leaderFirstName}</span>}
                                  {isMySubDateFuture && day && <span className="lineup-cal-leader-name sub-label">SUB</span>}
                                  {assignedAndFuture && !subAccepted && day && <div className="lineup-cal-dot" style={{ background: 'var(--accent)' }}></div>}
                                  {subAccepted && day && <div className="lineup-cal-dot" style={{ background: '#17a2b8' }}></div>}
                                  {isMySubDateFuture && day && <div className="lineup-cal-dot" style={{ background: '#9c27b0' }}></div>}
                                  {hasExcuse && !hasSub && day && <div className="lineup-cal-dot" style={{ background: myExcuse.status === 'Approved' ? '#28a745' : myExcuse.status === 'Rejected' ? '#dc3545' : '#ffc107' }}></div>}
                                </div>
                              );
                            })}
                          </div>
                          <div className="lineup-cal-legend">
                            <span><span className="legend-dot" style={{ background: '#bbb' }}></span> Assigned</span>
                            <span><span className="legend-dot" style={{ background: 'var(--accent)' }}></span> You&apos;re Assigned</span>
                            <span><span className="legend-dot" style={{ background: '#9c27b0' }}></span> You&apos;re Subbing</span>
                            <span><span className="legend-dot" style={{ background: '#17a2b8' }}></span> Substituted</span>
                            <span><span className="legend-dot" style={{ background: '#ffc107' }}></span> Excused</span>
                            <span><span className="legend-dot past"></span> Past Date</span>
                          </div>
                        </div>
                      </div>

                      {/* RIGHT: Info Cards */}
                      <div className="lu-sl-cards">
                        {/* Card 1: Your Assigned Dates This Month */}
                        <div className="lu-info-card">
                          <div className="lu-info-card-header gold">
                            <i className="fas fa-star"></i>
                            <span>Your Assigned Dates</span>
                          </div>
                          <div className="lu-info-card-body">
                            {getAssignedDates().length === 0 && getAcceptedSubsAsSubstitute().length === 0 ? (
                              <p className="lu-info-empty"><i className="fas fa-calendar-times"></i> No assigned dates yet. Admin will assign you.</p>
                            ) : (
                              <div className="lu-info-dates-list">
                                {getAssignedDates().map(dateStr => {
                                  const backups = getAssignedBackups(dateStr);
                                  const isPast = new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
                                  const hasSongs = (() => {
                                    const sch = scheduleData.find(s => s.scheduleDate === dateStr);
                                    return sch && ((sch.slowSongs?.length > 0 && sch.slowSongs.some(ss => ss.title)) || (sch.fastSongs?.length > 0 && sch.fastSongs.some(ss => ss.title)));
                                  })();
                                  const mySub = getSubForDate(dateStr);
                                  const schedule = scheduleData.find(s => s.scheduleDate === dateStr);
                                  return (
                                    <div key={dateStr} className={`lu-info-date-item${isPast ? ' past' : ''}${mySub?.status === 'Accepted' ? ' sub-excused' : ''}`}>
                                      <div className="lu-info-date-top-row" onClick={() => { if (!isPast) handleLineupDateSelect(dateStr); }}>
                                        <div className="lu-info-date-left">
                                          <span className="lu-info-date-day">{new Date(dateStr + 'T00:00:00').getDate()}</span>
                                          <span className="lu-info-date-month">{new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</span>
                                        </div>
                                        <div className="lu-info-date-right">
                                          <span className="lu-info-date-full">{formatDate(dateStr)}{isPast ? ' (Past)' : ''}</span>
                                          {backups.length > 0 && <span className="lu-info-date-backups"><i className="fas fa-users"></i> {backups.join(', ')}</span>}
                                          {!isPast && !mySub && hasSongs && <span className="lu-info-songs-ok"><i className="fas fa-check-circle"></i> Songs added</span>}
                                          {!isPast && !mySub && !hasSongs && <span className="lu-info-songs-missing"><i className="fas fa-exclamation-triangle"></i> Songs needed</span>}
                                          {mySub && mySub.status === 'Pending Admin' && <span className="lu-sub-status pending"><i className="fas fa-clock"></i> Sub request pending</span>}
                                          {mySub && mySub.status === 'Open for Sub' && <span className="lu-sub-status open"><i className="fas fa-broadcast-tower"></i> Open for sub</span>}
                                          {mySub && mySub.status === 'Accepted' && <span className="lu-sub-status accepted"><i className="fas fa-user-check"></i> Substituted by {mySub.substitute_name}</span>}
                                        </div>
                                      </div>
                                      {/* Sub action buttons */}
                                      {!isPast && !mySub && (
                                        <button className="lu-sub-request-btn" onClick={(e) => { e.stopPropagation(); setSubModalDate(dateStr); setSubModalScheduleId(schedule?.scheduleId || null); setSubModalRoleType('Song Leader'); setSubReason(''); }} title="Request a substitute Song Leader">
                                          <i className="fas fa-people-arrows"></i> Request Substitute
                                        </button>
                                      )}
                                      {!isPast && mySub && mySub.status === 'Pending Admin' && (
                                        <button className="lu-sub-cancel-btn" onClick={(e) => { e.stopPropagation(); cancelSubRequest(mySub.id); }}>
                                          <i className="fas fa-times"></i> Cancel Sub Request
                                        </button>
                                      )}
                                      {!isPast && mySub && mySub.status === 'Accepted' && !mySub.thank_you_sent && (
                                        <button className="lu-sub-thankyou-btn" onClick={(e) => { e.stopPropagation(); setSubThankYouModal({ subId: mySub.id, subName: mySub.substitute_name }); setSubThankYouMessage(''); }}>
                                          <i className="fas fa-heart"></i> Say Thank You to {mySub.substitute_name?.split(' ')[0]}
                                        </button>
                                      )}
                                      {mySub && mySub.thank_you_sent && (
                                        <span className="lu-sub-thankyou-sent"><i className="fas fa-check-circle"></i> Thank you sent!</span>
                                      )}
                                    </div>
                                  );
                                })}
                                {/* Show sub dates where I'm the substitute */}
                                {getAcceptedSubsAsSubstitute().map(sub => {
                                  const dateStr = sub.schedule_date;
                                  const isPast = new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
                                  return (
                                    <div key={`sub-${sub.id}`} className={`lu-info-date-item sub-date${isPast ? ' past' : ''}`} onClick={() => { if (!isPast) handleLineupDateSelect(dateStr); }}>
                                      <div className="lu-info-date-left sub">
                                        <span className="lu-info-date-day">{new Date(dateStr + 'T00:00:00').getDate()}</span>
                                        <span className="lu-info-date-month">{new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}</span>
                                      </div>
                                      <div className="lu-info-date-right">
                                        <span className="lu-info-date-full">{formatDate(dateStr)}</span>
                                        <span className="lu-sub-status substituting"><i className="fas fa-hand-holding-heart"></i> Subbing for {sub.requester_name}</span>
                                        {!isPast && <span className="lu-info-songs-missing"><i className="fas fa-music"></i> Tap to add songs</span>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Card: Open Sub Requests (from other Song Leaders) */}
                        {getOpenSubsForMe().length > 0 && (
                          <div className="lu-info-card">
                            <div className="lu-info-card-header purple">
                              <i className="fas fa-people-arrows"></i>
                              <span>Open Sub Requests</span>
                              <span className="lu-sub-badge">{getOpenSubsForMe().length}</span>
                            </div>
                            <div className="lu-info-card-body">
                              <p className="lu-info-hint">A fellow {(() => { const usr = userData?.sub_role || ''; return usr.includes('Song Leaders') ? 'Song Leader' : usr.includes('Backup Singer') ? 'Backup Singer' : usr.includes('Instrumentalist') ? 'Instrumentalist' : usr.includes('Dancer') ? 'Dancer' : 'member'; })()} needs a substitute. Can you help?</p>
                              <div className="lu-sub-requests-list">
                                {getOpenSubsForMe().map(sub => (
                                  <div key={sub.id} className="lu-sub-request-card">
                                    <div className="lu-sub-request-profile">
                                      <div className="lu-sub-request-avatar">
                                        {sub.requester_profile_picture ? <img src={sub.requester_profile_picture} alt="" referrerPolicy="no-referrer" /> : <span>{getInitials(sub.requester_name)}</span>}
                                      </div>
                                      <div className="lu-sub-request-info">
                                        <strong>{sub.requester_name}</strong>
                                        <span className="lu-sub-request-date"><i className="fas fa-calendar-day"></i> {formatDate(sub.schedule_date)}</span>
                                      </div>
                                    </div>
                                    <p className="lu-sub-request-reason"><i className="fas fa-quote-left"></i> {sub.reason}</p>
                                    <div className="lu-sub-request-actions">
                                      <button className="lu-sub-accept-btn" onClick={() => acceptSubRequest(sub.id)}>
                                        <i className="fas fa-check"></i> I&apos;ll Sub!
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Card 2: Pending Songs Alert */}
                        {getAssignedDatesMissingSongs().length > 0 && (
                          <div className="lu-info-card alert">
                            <div className="lu-info-card-header red">
                              <i className="fas fa-exclamation-circle"></i>
                              <span>Songs Needed!</span>
                            </div>
                            <div className="lu-info-card-body">
                              <p className="lu-info-alert-text">You have <strong>{getAssignedDatesMissingSongs().length}</strong> upcoming {getAssignedDatesMissingSongs().length === 1 ? 'date' : 'dates'} without songs. Please add your song lineup.</p>
                              {getAssignedDatesMissingSongs().map(sch => (
                                <div key={sch.scheduleDate} className="lu-info-alert-item" onClick={() => handleLineupDateSelect(sch.scheduleDate)}>
                                  <i className="fas fa-arrow-right"></i> <strong>{formatDate(sch.scheduleDate)}</strong> — Tap to add songs
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Card 3: My Excuses */}
                        <div className="lu-info-card">
                          <div className="lu-info-card-header blue">
                            <i className="fas fa-calendar-minus"></i>
                            <span>My Excuse Dates</span>
                          </div>
                          <div className="lu-info-card-body">
                            <p className="lu-info-hint">Click an available (non-assigned) future date on the calendar to file an excuse.</p>
                            {getMyExcuses().length === 0 ? (
                              <p className="lu-info-empty"><i className="fas fa-check-circle"></i> No excuses filed.</p>
                            ) : (
                              <div className="lu-excuse-list">
                                {getMyExcuses().map(exc => {
                                  const isPast = new Date(exc.excuse_date + 'T00:00:00') < new Date(new Date().toDateString());
                                  return (
                                    <div key={exc.id} className={`lu-excuse-item ${exc.status.toLowerCase()}${isPast ? ' past' : ''}`}>
                                      <div className="lu-excuse-item-top">
                                        <span className="lu-excuse-date">{formatDate(exc.excuse_date)}</span>
                                        <span className={`lu-excuse-status ${exc.status.toLowerCase()}`}>{exc.status}</span>
                                      </div>
                                      <p className="lu-excuse-reason"><i className="fas fa-quote-left"></i> {exc.reason}</p>
                                      {exc.admin_note && <p className="lu-excuse-admin-note"><i className="fas fa-comment-dots"></i> Admin: {exc.admin_note}</p>}
                                      {exc.status === 'Pending' && !isPast && (
                                        <button className="lu-excuse-cancel-btn" onClick={() => cancelExcuse(exc.id)}><i className="fas fa-times"></i> Cancel</button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Detail Popup for viewing other leader's date */}
                      {lineupDetailPopup && (
                        <div className="lineup-detail-overlay" onClick={() => setLineupDetailPopup(null)}>
                          <div className={`lineup-detail-modal${lineupDetailPopup.substitutedBy ? ' sub-detail' : ''}`} onClick={(e) => e.stopPropagation()}>
                            <button className="lineup-detail-close" onClick={() => setLineupDetailPopup(null)}><i className="fas fa-times"></i></button>
                            <div className="lineup-detail-modal-header">
                              <i className="fas fa-calendar-day"></i>
                              <h3>{formatDate(lineupDetailPopup.date)}</h3>
                            </div>
                            <div className="lineup-detail-modal-body">
                              {lineupDetailPopup.substitutedBy && (
                                <div className="lu-detail-sub-banner">
                                  <i className="fas fa-people-arrows"></i>
                                  <span>Substituted by <strong>{lineupDetailPopup.substitutedBy}</strong></span>
                                </div>
                              )}
                              <div className="lineup-detail-row"><i className="fas fa-microphone" style={{ color: 'var(--primary)' }}></i><div><span className="lineup-detail-label">Song Leader</span><span className="lineup-detail-value">{lineupDetailPopup.songLeader} {lineupDetailPopup.substitutedBy ? '(Substitute)' : ''}</span></div></div>
                              <div className="lineup-detail-row"><i className="fas fa-users" style={{ color: 'var(--secondary)' }}></i><div><span className="lineup-detail-label">Backup Singers</span><span className="lineup-detail-value">{lineupDetailPopup.backupSingers.length > 0 ? lineupDetailPopup.backupSingers.join(', ') : 'None assigned'}</span></div></div>
                              {(lineupDetailPopup.slowSongs.length > 0 || lineupDetailPopup.fastSongs.length > 0) && (
                                <div className="lineup-detail-songs">
                                  <span className="lineup-detail-label" style={{ marginBottom: 8, display: 'block' }}>Songs</span>
                                  {lineupDetailPopup.slowSongs.map((s, si) => <div key={`s-${si}`} className="lineup-detail-song-pill slow"><i className="fas fa-music"></i> {s.title}</div>)}
                                  {lineupDetailPopup.fastSongs.map((s, si) => <div key={`f-${si}`} className="lineup-detail-song-pill fast"><i className="fas fa-bolt"></i> {s.title}</div>)}
                                </div>
                              )}
                              {lineupDetailPopup.substitutedBy && (
                                <div className="lu-detail-sub-note">
                                  <i className="fas fa-lock"></i>
                                  <span>You can no longer edit songs for this date. The substitute Song Leader is now in charge of the lineup.</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SONG LEADER FORM VIEW (non-admin) */}
                  {lineupView === 'form' && !isAdmin && (
                    <div className="lineup-form-modern">
                      {isSubstituteDateForMe(lineupForm.scheduleDate) && (() => {
                        const sched = scheduleData.find(s => s.scheduleDate === lineupForm.scheduleDate);
                        return sched?.hasSubstitute && sched?.originalSongLeader ? (
                          <div className="lu-sub-banner">
                            <i className="fas fa-hand-holding-heart"></i>
                            <span>You&apos;re substituting for <strong>{sched.originalSongLeader}</strong> on this date</span>
                          </div>
                        ) : null;
                      })()}
                      <div className="lineup-date-banner">
                        <div className="lineup-date-banner-left"><i className="fas fa-calendar-check"></i><div><span className="lineup-date-label">Schedule Date</span><span className="lineup-date-value">{formatDate(lineupForm.scheduleDate)}</span></div></div>
                        <button className="btn-change-date" onClick={() => { resetLineupForm(); }}><i className="fas fa-arrow-left"></i> Back</button>
                      </div>

                      <div className="lineup-assignment-info">
                        <div className="lineup-assignment-row">
                          <div className="lineup-assignment-item"><i className="fas fa-microphone" style={{ color: 'var(--primary)' }}></i><div><span className="lineup-assignment-label">Song Leader</span><span className="lineup-assignment-value">{lineupForm.songLeader}</span></div></div>
                          <div className="lineup-assignment-item"><i className="fas fa-users" style={{ color: 'var(--secondary)' }}></i><div><span className="lineup-assignment-label">Backup Singers</span><span className="lineup-assignment-value">{lineupForm.backupSingers.filter(s => s).length > 0 ? lineupForm.backupSingers.filter(s => s).join(', ') : 'None assigned'}</span></div></div>
                        </div>
                      </div>

                      <div className="lineup-practice-section">
                        <label className="lineup-practice-section-label"><i className="fas fa-guitar"></i> Practice Schedule</label>
                        <div className="lineup-practice-grid">
                          <div className="lineup-practice-field">
                            <label>Date</label>
                            <input type="date" className="form-control" value={lineupForm.practiceDate} onChange={(e) => handleLineupChange('practiceDate', e.target.value)} />
                          </div>
                          <div className="lineup-practice-field">
                            <label>Time</label>
                            <input type="time" className="form-control" value={lineupForm.practiceTime} onChange={(e) => handleLineupChange('practiceTime', e.target.value)} />
                          </div>
                        </div>
                        {lineupForm.practiceDate && (
                          <div className="lineup-practice-preview">
                            <i className="fas fa-calendar-check"></i>
                            {new Date(lineupForm.practiceDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                            {lineupForm.practiceTime && ` • ${new Date('2000-01-01T' + lineupForm.practiceTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`}
                          </div>
                        )}
                      </div>

                      <div className="lineup-songs-grid">
                        {['slowSongs', 'fastSongs'].map((type) => (
                          <div key={type} className="lineup-song-column">
                            <div className={`lineup-song-column-header ${type}`}>
                              <i className={`fas fa-${type === 'slowSongs' ? 'music' : 'bolt'}`}></i>
                              <span>{type === 'slowSongs' ? 'Slow Songs' : 'Fast Songs'}</span>
                              <span className="song-count-badge">{lineupForm[type].filter(s => s.title).length}</span>
                            </div>
                            <div className="lineup-song-list">
                              {lineupForm[type].map((song, i) => {
                                const scanKey = `${type}-${i}`;
                                const scan = songScanResults[scanKey];
                                const vidId = song.link ? extractYouTubeId(song.link) : null;
                                return (
                                <div key={i} className={`lineup-song-card${song.title ? ' has-title' : ''}${scan?.status === 'explicit' ? ' scan-explicit' : scan?.status === 'warning' ? ' scan-warning' : scan?.status === 'safe' ? ' scan-safe' : ''}`}>
                                  <div className="lineup-song-card-header">
                                    <span className="lineup-song-num">{type === 'slowSongs' ? '🎵' : '⚡'} Song {i + 1}</span>
                                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                      {(song.title || song.link) && <button className="btn-scan-song" onClick={() => rescanSong(type, i)} title="Scan with AI"><i className="fas fa-shield-alt"></i></button>}
                                      {lineupForm[type].length > 1 && <button className="btn-remove-sm" onClick={() => removeSong(type, i)}><i className="fas fa-trash-alt"></i></button>}
                                    </div>
                                  </div>
                                  {scan && (
                                    <div className={`song-scan-badge scan-${scan.status}`}>
                                      <div className="song-scan-icon">{scan.status === 'scanning' && <div className="scan-spinner"></div>}{scan.status === 'safe' && <i className="fas fa-check-circle"></i>}{scan.status === 'explicit' && <i className="fas fa-exclamation-triangle"></i>}{scan.status === 'warning' && <i className="fas fa-exclamation-circle"></i>}{scan.status === 'error' && <i className="fas fa-question-circle"></i>}</div>
                                      <div className="song-scan-text"><span className="song-scan-label">{scan.message}</span>{scan.details && <span className="song-scan-details">{scan.details}</span>}</div>
                                    </div>
                                  )}
                                  <div className="song-title-input-wrap">
                                    <input className="form-control" placeholder={songAutoFillLoading[`${type}-${i}`] ? 'Detecting song title...' : 'Song title *'} value={song.title} onChange={(e) => handleSongChange(type, i, 'title', e.target.value)} disabled={!!songAutoFillLoading[`${type}-${i}`]} />
                                    {songAutoFillLoading[`${type}-${i}`] && <div className="song-title-autofill-spinner"><div className="scan-spinner"></div></div>}
                                  </div>
                                  <input className="form-control" placeholder="YouTube link (optional)" value={song.link} onChange={(e) => handleSongChange(type, i, 'link', e.target.value)} />
                                  {vidId && (
                                    <div className="lineup-yt-thumb" onClick={() => window.open(song.link, '_blank')}>
                                      <img src={`https://img.youtube.com/vi/${vidId}/mqdefault.jpg`} alt="thumbnail" />
                                      <div className="lineup-yt-play"><i className="fab fa-youtube"></i></div>
                                    </div>
                                  )}
                                  <input className="form-control" placeholder="Instructions (optional)" value={song.instructions} onChange={(e) => handleSongChange(type, i, 'instructions', e.target.value)} />
                                </div>
                                );
                              })}
                            </div>
                            {lineupForm[type].length < 5 && <button className="btn-add-song" onClick={() => addSong(type)}><i className="fas fa-plus-circle"></i> Add {type === 'slowSongs' ? 'Slow' : 'Fast'} Song</button>}
                          </div>
                        ))}
                      </div>

                      <div className="lineup-mm-note">
                        <i className="fas fa-desktop"></i>
                        <span>Lyrics will be prepared by the <strong>Multimedia Team</strong>. Just add the song title and YouTube link.</span>
                      </div>

                      <div className="lineup-submit-row">
                        <button className="btn-secondary" onClick={resetLineupForm}><i className="fas fa-arrow-left"></i> Cancel</button>
                        <button className="btn-primary btn-submit-lineup" onClick={submitLineup} disabled={lineupLoading}>
                          {lineupLoading ? <><div className="spinner" style={{ display: 'inline-block', width: 18, height: 18, marginRight: 8 }}></div> Saving...</> : <><i className="fas fa-paper-plane"></i> {editingLineup ? 'Update Songs' : 'Submit Songs'}</>}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ===== ALL ASSIGNMENTS TAB ===== */}
              {lineupTab === 'all' && (
                <div className="lu-all-container">
                  {/* View Detail Modal */}
                  {lineupViewingAssignment && (
                    <div className="um-modal-overlay" onClick={() => setLineupViewingAssignment(null)}>
                      <div className="lu-view-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="lu-view-modal-header">
                          <h3><i className="fas fa-calendar-day"></i> {formatDate(lineupViewingAssignment.scheduleDate)}</h3>
                          <button className="btn-close-modal" onClick={() => setLineupViewingAssignment(null)}><i className="fas fa-times"></i></button>
                        </div>
                        <div className="lu-view-modal-body">
                          <div className="lu-view-row"><span className="lu-view-label"><i className="fas fa-microphone"></i> {lineupViewingAssignment.hasSubstitute ? 'Song Leader (Substitute)' : 'Song Leader'}</span><span className="lu-view-value">{lineupViewingAssignment.songLeader}</span></div>
                          {lineupViewingAssignment.hasSubstitute && lineupViewingAssignment.originalSongLeader && <div className="lu-view-row"><span className="lu-view-label"><i className="fas fa-user-tag"></i> Song Leader</span><span className="lu-view-value paw-grayed-out">{lineupViewingAssignment.originalSongLeader}</span></div>}
                          <div className="lu-view-row"><span className="lu-view-label"><i className="fas fa-users"></i> Backup Singers</span><span className="lu-view-value">{lineupViewingAssignment.backupSingers?.length > 0 ? lineupViewingAssignment.backupSingers.join(', ') : 'None'}</span></div>
                          {lineupViewingAssignment.practiceDate && <div className="lu-view-row"><span className="lu-view-label"><i className="fas fa-calendar-alt"></i> Practice Date</span><span className="lu-view-value">{formatDate(lineupViewingAssignment.practiceDate)}</span></div>}
                          {((lineupViewingAssignment.slowSongs?.length > 0 && lineupViewingAssignment.slowSongs.some(s => s.title)) || (lineupViewingAssignment.fastSongs?.length > 0 && lineupViewingAssignment.fastSongs.some(s => s.title))) && (
                            <div className="lu-view-songs">
                              <span className="lu-view-label" style={{ marginBottom: 8, display: 'block' }}><i className="fas fa-music"></i> Songs</span>
                              <div className="lu-view-songs-grid">
                                {lineupViewingAssignment.slowSongs?.filter(s => s.title).map((s, i) => (
                                  <div key={`s-${i}`} className="lu-view-song-pill slow">
                                    <i className="fas fa-music"></i> {s.title}
                                    {s.link && extractYouTubeId(s.link) && <a href={s.link} target="_blank" rel="noopener noreferrer" className="lu-yt-link"><i className="fab fa-youtube"></i></a>}
                                  </div>
                                ))}
                                {lineupViewingAssignment.fastSongs?.filter(s => s.title).map((s, i) => (
                                  <div key={`f-${i}`} className="lu-view-song-pill fast">
                                    <i className="fas fa-bolt"></i> {s.title}
                                    {s.link && extractYouTubeId(s.link) && <a href={s.link} target="_blank" rel="noopener noreferrer" className="lu-yt-link"><i className="fab fa-youtube"></i></a>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {isAdmin && lineupViewingAssignment.submittedBy && (
                            <div className="lu-view-row"><span className="lu-view-label"><i className="fas fa-user-edit"></i> Created by</span><span className="lu-view-value">{lineupViewingAssignment.submittedBy}</span></div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {getMyLineups().length === 0 ? (
                    <div className="lineup-empty-state">
                      <i className="fas fa-music"></i>
                      <h3>{isAdmin ? 'No Assignments Yet' : 'No Lineups Yet'}</h3>
                      <p>{isAdmin ? 'No Song Leaders have been assigned yet.' : 'You have no assigned dates yet.'}</p>
                      <button className="btn-primary" onClick={() => { resetLineupForm(); setLineupTab('assign'); }} style={{ marginTop: 15, padding: '12px 25px' }}><i className="fas fa-plus"></i> {isAdmin ? 'Assign Lineup' : 'Back to Calendar'}</button>
                    </div>
                  ) : (
                    <div className="lu-assignments-list">
                      {getMyLineups().map((lineup) => {
                        const hasSongs = (lineup.slowSongs?.length > 0 && lineup.slowSongs.some(s => s.title)) || (lineup.fastSongs?.length > 0 && lineup.fastSongs.some(s => s.title));
                        const isPast = new Date(lineup.scheduleDate + 'T00:00:00') < new Date(new Date().toDateString());
                        return (
                          <div key={lineup.scheduleId} className={`lu-assignment-card${isPast ? ' past' : ''}${lineup.hasSubstitute ? ' has-sub' : ''}`}>
                            <div className="lu-assignment-date-col">
                              <span className="lu-assignment-month">{new Date(lineup.scheduleDate).toLocaleDateString('en-US', { month: 'short' })}</span>
                              <span className="lu-assignment-day">{new Date(lineup.scheduleDate).getDate()}</span>
                              <span className="lu-assignment-year">{new Date(lineup.scheduleDate).getFullYear()}</span>
                            </div>
                            <div className="lu-assignment-info">
                              <div className="lu-assignment-leader"><i className="fas fa-microphone"></i> {lineup.hasSubstitute ? 'Song Leader (Substitute): ' : ''}{lineup.songLeader}</div>
                              {lineup.hasSubstitute && lineup.originalSongLeader && <div className="lu-assignment-sub-info"><i className="fas fa-user"></i> Song Leader: <strong className="paw-grayed-out">{lineup.originalSongLeader}</strong></div>}
                              {lineup.backupSingers?.length > 0 && <div className="lu-assignment-backups"><i className="fas fa-users"></i> {lineup.backupSingers.join(', ')}</div>}
                              {hasSongs && <div className="lu-assignment-songs-count"><i className="fas fa-music"></i> {(lineup.slowSongs?.filter(s => s.title).length || 0) + (lineup.fastSongs?.filter(s => s.title).length || 0)} songs</div>}
                              {!isAdmin && !hasSongs && !isPast && <div className="lu-assignment-no-songs"><i className="fas fa-exclamation-circle"></i> Songs not yet added</div>}
                            </div>
                            <div className="lu-assignment-actions">
                              <button className="lu-action-btn lu-action-view" onClick={() => setLineupViewingAssignment(lineup)} title="View"><i className="fas fa-eye"></i></button>
                              {!isPast && (
                                <button className="lu-action-btn lu-action-edit" onClick={() => startEditLineup(lineup)} title="Edit"><i className="fas fa-edit"></i></button>
                              )}
                              {isAdmin && (
                                deleteConfirmId === lineup.scheduleId ? (
                                  <div className="lu-delete-confirm">
                                    <button className="lu-action-btn lu-action-confirm-yes" onClick={() => deleteLineup(lineup.scheduleId)}><i className="fas fa-check"></i></button>
                                    <button className="lu-action-btn lu-action-confirm-no" onClick={() => setDeleteConfirmId(null)}><i className="fas fa-times"></i></button>
                                  </div>
                                ) : (
                                  <button className="lu-action-btn lu-action-delete" onClick={() => setDeleteConfirmId(lineup.scheduleId)} title="Delete"><i className="fas fa-trash-alt"></i></button>
                                )
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ===== PAW LOGS TAB (Admin) / EXCUSE HISTORY (Song Leader) ===== */}
              {lineupTab === 'paw-logs' && (
                <div className="paw-logs-container">

                  {/* ---- ADMIN: Full PAW Logs ---- */}
                  {isAdmin && (
                    <>
                      {/* Stats Row */}
                      <div className="paw-stats-row">
                        <div className="paw-stat-card pending">
                          <div className="paw-stat-icon"><i className="fas fa-clock"></i></div>
                          <div className="paw-stat-info">
                            <span className="paw-stat-num">{getPawExcuseStats().pending}</span>
                            <span className="paw-stat-label">Pending</span>
                          </div>
                        </div>
                        <div className="paw-stat-card approved">
                          <div className="paw-stat-icon"><i className="fas fa-check-circle"></i></div>
                          <div className="paw-stat-info">
                            <span className="paw-stat-num">{getPawExcuseStats().approved}</span>
                            <span className="paw-stat-label">Approved</span>
                          </div>
                        </div>
                        <div className="paw-stat-card rejected">
                          <div className="paw-stat-icon"><i className="fas fa-times-circle"></i></div>
                          <div className="paw-stat-info">
                            <span className="paw-stat-num">{getPawExcuseStats().rejected}</span>
                            <span className="paw-stat-label">Rejected</span>
                          </div>
                        </div>
                        <div className="paw-stat-card total">
                          <div className="paw-stat-icon"><i className="fas fa-clipboard-list"></i></div>
                          <div className="paw-stat-info">
                            <span className="paw-stat-num">{getPawExcuseStats().total}</span>
                            <span className="paw-stat-label">Total</span>
                          </div>
                        </div>
                      </div>

                      {/* Admin Pending Notifications */}
                      {getPendingExcuses().length > 0 && (
                        <div className="paw-notif-section">
                          <div className="paw-notif-header">
                            <i className="fas fa-bell"></i>
                            <span>Pending Excuse Requests</span>
                            <span className="paw-notif-badge">{getPendingExcuses().length}</span>
                          </div>
                          <div className="paw-notif-list">
                            {getPendingExcuses().map(exc => {
                              const pic = getExcuseProfilePic(exc);
                              const roleColor = PAW_ROLE_COLORS[exc.role_type || 'Song Leader'] || '#926c15';
                              return (
                                <div key={exc.id} className="paw-notif-card">
                                  <div className="paw-notif-avatar" style={{ borderColor: roleColor }}>
                                    {pic ? <img src={pic} alt="" referrerPolicy="no-referrer" /> : <span>{getInitials(exc.user_name)}</span>}
                                  </div>
                                  <div className="paw-notif-body">
                                    <div className="paw-notif-top">
                                      <strong>{exc.user_name}</strong>
                                      <span className="paw-notif-role" style={{ background: `${roleColor}18`, color: roleColor }}><i className={`fas ${PAW_ROLE_ICONS[exc.role_type || 'Song Leader']}`}></i> {exc.role_type || 'Song Leader'}</span>
                                    </div>
                                    <div className="paw-notif-date"><i className="fas fa-calendar-day"></i> {formatDate(exc.excuse_date)}</div>
                                    <p className="paw-notif-reason"><i className="fas fa-quote-left"></i> {exc.reason}</p>
                                    <div className="paw-notif-time"><i className="fas fa-clock"></i> Filed {new Date(exc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                  </div>
                                  <div className="paw-notif-actions">
                                    <button className="paw-action-approve" onClick={() => reviewExcuse(exc.id, 'Approved')} title="Approve"><i className="fas fa-check"></i></button>
                                    <button className="paw-action-reject" onClick={() => reviewExcuse(exc.id, 'Rejected')} title="Reject"><i className="fas fa-times"></i></button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Admin Pending Sub Requests in PAW Logs */}
                      {getPendingAdminSubs().length > 0 && (
                        <div className="paw-notif-section paw-sub-notif-section">
                          <div className="paw-notif-header" style={{ borderLeftColor: '#9c27b0' }}>
                            <i className="fas fa-people-arrows" style={{ color: '#9c27b0' }}></i>
                            <span>Pending Substitute Requests</span>
                            <span className="paw-notif-badge" style={{ background: '#9c27b0' }}>{getPendingAdminSubs().length}</span>
                          </div>
                          <div className="paw-notif-list">
                            {getPendingAdminSubs().map(sub => (
                              <div key={sub.id} className="paw-notif-card">
                                <div className="paw-notif-avatar" style={{ borderColor: '#9c27b0' }}>
                                  {sub.requester_profile_picture ? <img src={sub.requester_profile_picture} alt="" referrerPolicy="no-referrer" /> : <span>{getInitials(sub.requester_name)}</span>}
                                </div>
                                <div className="paw-notif-body">
                                  <div className="paw-notif-top">
                                    <strong>{sub.requester_name}</strong>
                                    <span className="paw-notif-role" style={{ background: (sub.role_type || 'Song Leader') === 'Song Leader' ? 'rgba(146,108,21,0.12)' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? 'rgba(23,162,184,0.12)' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? 'rgba(111,66,193,0.12)' : 'rgba(232,62,140,0.12)', color: (sub.role_type || 'Song Leader') === 'Song Leader' ? '#926c15' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? '#17a2b8' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? '#6f42c1' : '#e83e8c' }}>
                                      <i className={`fas ${(sub.role_type || 'Song Leader') === 'Song Leader' ? 'fa-microphone' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? 'fa-users' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? 'fa-guitar' : 'fa-shoe-prints'}`}></i> {sub.role_type || 'Song Leader'}
                                    </span>
                                  </div>
                                  <div className="paw-notif-date"><i className="fas fa-calendar-day"></i> {formatDate(sub.schedule_date)}</div>
                                  <p className="paw-notif-reason"><i className="fas fa-quote-left"></i> {sub.reason}</p>
                                  <div className="paw-notif-time"><i className="fas fa-clock"></i> Filed {new Date(sub.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                </div>
                                <div className="paw-notif-actions">
                                  <button className="paw-action-approve" onClick={() => adminReviewSub(sub.id, 'approve')} title={`Approve & Notify All ${(sub.role_type || 'Song Leader') === 'Song Leader' ? 'Song Leaders' : (sub.role_type || 'Song Leader') + 's'}`}><i className="fas fa-check"></i></button>
                                  <button className="paw-action-reject" onClick={() => adminReviewSub(sub.id, 'reject')} title="Reject"><i className="fas fa-times"></i></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sub-Tab Toggle: Excuses vs Substitutes */}
                      <div className="paw-sub-tab-bar">
                        <button className={`paw-sub-tab ${pawLogsSubTab === 'excuses' ? 'active' : ''}`} onClick={() => { setPawLogsSubTab('excuses'); setPawLogsFilter('All'); setPawLogsSearch(''); }}>
                          <i className="fas fa-calendar-minus"></i> Excuses
                          <span className="paw-sub-tab-count">{lineupExcuses.length}</span>
                        </button>
                        <button className={`paw-sub-tab ${pawLogsSubTab === 'substitutes' ? 'active' : ''}`} onClick={() => { setPawLogsSubTab('substitutes'); setPawLogsFilter('All'); setPawLogsSearch(''); }}>
                          <i className="fas fa-people-arrows"></i> Substitutes
                          <span className="paw-sub-tab-count">{subRequests.length}</span>
                        </button>
                      </div>

                      {/* ==== EXCUSES SUB-TAB ==== */}
                      {pawLogsSubTab === 'excuses' && (
                        <>
                      {/* Search & Filters */}
                      <div className="paw-filters-bar">
                        <div className="paw-search-box">
                          <i className="fas fa-search"></i>
                          <input type="text" placeholder="Search by name, reason, date, or role..." value={pawLogsSearch} onChange={(e) => setPawLogsSearch(e.target.value)} />
                          {pawLogsSearch && <button className="paw-search-clear" onClick={() => setPawLogsSearch('')}><i className="fas fa-times"></i></button>}
                        </div>
                        <div className="paw-filter-group">
                          <div className="paw-filter-pills">
                            {['All', 'Pending', 'Approved', 'Rejected'].map(s => (
                              <button key={s} className={`paw-filter-pill ${pawLogsFilter === s ? 'active' : ''} ${s.toLowerCase()}`} onClick={() => setPawLogsFilter(s)}>{s}</button>
                            ))}
                          </div>
                          <select className="paw-role-select" value={pawLogsRoleFilter} onChange={(e) => setPawLogsRoleFilter(e.target.value)}>
                            <option value="All">All Roles</option>
                            {PAW_ROLE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Results Count */}
                      <div className="paw-results-info">
                        <span>{getFilteredPawExcuses().length} excuse{getFilteredPawExcuses().length !== 1 ? 's' : ''} found</span>
                        {(pawLogsFilter !== 'All' || pawLogsRoleFilter !== 'All' || pawLogsSearch) && (
                          <button className="paw-clear-filters" onClick={() => { setPawLogsFilter('All'); setPawLogsRoleFilter('All'); setPawLogsSearch(''); }}><i className="fas fa-times"></i> Clear filters</button>
                        )}
                      </div>

                      {/* Excuse List */}
                      {getFilteredPawExcuses().length === 0 ? (
                        <div className="paw-empty-state">
                          <i className="fas fa-clipboard-check"></i>
                          <h3>No Excuses Found</h3>
                          <p>{pawLogsSearch || pawLogsFilter !== 'All' || pawLogsRoleFilter !== 'All' ? 'Try adjusting your search or filters.' : 'No PAW excuse records yet.'}</p>
                        </div>
                      ) : (
                        <div className="paw-excuse-grid">
                          {getFilteredPawExcuses().map(exc => {
                            const pic = getExcuseProfilePic(exc);
                            const roleColor = PAW_ROLE_COLORS[exc.role_type || 'Song Leader'] || '#926c15';
                            const isPast = new Date(exc.excuse_date + 'T00:00:00') < new Date(new Date().toDateString());
                            return (
                              <div key={exc.id} className={`paw-excuse-card ${exc.status.toLowerCase()}${isPast ? ' past' : ''}`}>
                                <div className="paw-excuse-card-top">
                                  <div className="paw-excuse-profile">
                                    <div className="paw-excuse-avatar" style={{ borderColor: roleColor }}>
                                      {pic ? <img src={pic} alt="" referrerPolicy="no-referrer" /> : <span>{getInitials(exc.user_name)}</span>}
                                    </div>
                                    <div className="paw-excuse-user-info">
                                      <strong>{exc.user_name}</strong>
                                      <span className="paw-excuse-role-tag" style={{ background: `${roleColor}15`, color: roleColor }}>
                                        <i className={`fas ${PAW_ROLE_ICONS[exc.role_type || 'Song Leader']}`}></i> {exc.role_type || 'Song Leader'}
                                      </span>
                                    </div>
                                  </div>
                                  <span className={`paw-excuse-status ${exc.status.toLowerCase()}`}>{exc.status}</span>
                                </div>
                                <div className="paw-excuse-card-body">
                                  <div className="paw-excuse-date-row">
                                    <i className="fas fa-calendar-day"></i>
                                    <span>{formatDate(exc.excuse_date)}</span>
                                    {isPast && <span className="paw-past-tag">Past</span>}
                                  </div>
                                  <p className="paw-excuse-reason-text"><i className="fas fa-quote-left"></i> {exc.reason}</p>
                                  {exc.admin_note && (
                                    <div className="paw-excuse-admin-note"><i className="fas fa-comment-dots"></i> <strong>Admin:</strong> {exc.admin_note}</div>
                                  )}
                                  {exc.reviewed_by && (
                                    <div className="paw-excuse-reviewer"><i className="fas fa-user-check"></i> Reviewed by {exc.reviewed_by}</div>
                                  )}
                                </div>
                                <div className="paw-excuse-card-footer">
                                  <span className="paw-excuse-filed-time"><i className="fas fa-clock"></i> {new Date(exc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                  {exc.status === 'Pending' && (
                                    <div className="paw-excuse-card-actions">
                                      <button className="paw-action-sm approve" onClick={() => reviewExcuse(exc.id, 'Approved')}><i className="fas fa-check"></i> Approve</button>
                                      <button className="paw-action-sm reject" onClick={() => reviewExcuse(exc.id, 'Rejected')}><i className="fas fa-times"></i> Reject</button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                        </>
                      )}

                      {/* ==== SUBSTITUTES SUB-TAB ==== */}
                      {pawLogsSubTab === 'substitutes' && (
                        <>
                          {/* Sub Stats Row */}
                          <div className="paw-stats-row">
                            <div className="paw-stat-card pending">
                              <div className="paw-stat-icon"><i className="fas fa-clock"></i></div>
                              <div className="paw-stat-info">
                                <span className="paw-stat-num">{getPawSubStats().pending}</span>
                                <span className="paw-stat-label">Pending</span>
                              </div>
                            </div>
                            <div className="paw-stat-card open-sub">
                              <div className="paw-stat-icon"><i className="fas fa-broadcast-tower"></i></div>
                              <div className="paw-stat-info">
                                <span className="paw-stat-num">{getPawSubStats().open}</span>
                                <span className="paw-stat-label">Open</span>
                              </div>
                            </div>
                            <div className="paw-stat-card approved">
                              <div className="paw-stat-icon"><i className="fas fa-check-circle"></i></div>
                              <div className="paw-stat-info">
                                <span className="paw-stat-num">{getPawSubStats().accepted}</span>
                                <span className="paw-stat-label">Accepted</span>
                              </div>
                            </div>
                            <div className="paw-stat-card total">
                              <div className="paw-stat-icon"><i className="fas fa-clipboard-list"></i></div>
                              <div className="paw-stat-info">
                                <span className="paw-stat-num">{getPawSubStats().total}</span>
                                <span className="paw-stat-label">Total</span>
                              </div>
                            </div>
                          </div>

                          {/* Search & Filters */}
                          <div className="paw-filters-bar">
                            <div className="paw-search-box">
                              <i className="fas fa-search"></i>
                              <input type="text" placeholder="Search by name, reason, or date..." value={pawLogsSearch} onChange={(e) => setPawLogsSearch(e.target.value)} />
                              {pawLogsSearch && <button className="paw-search-clear" onClick={() => setPawLogsSearch('')}><i className="fas fa-times"></i></button>}
                            </div>
                            <div className="paw-filter-pills">
                              {['All', 'Pending', 'Open', 'Approved', 'Rejected'].map(s => (
                                <button key={s} className={`paw-filter-pill ${pawLogsFilter === s ? 'active' : ''} ${s.toLowerCase()}`} onClick={() => setPawLogsFilter(s)}>{s}</button>
                              ))}
                            </div>
                          </div>

                          {/* Results Count */}
                          <div className="paw-results-info">
                            <span>{getFilteredPawSubs().length} substitute request{getFilteredPawSubs().length !== 1 ? 's' : ''} found</span>
                            {(pawLogsFilter !== 'All' || pawLogsSearch) && (
                              <button className="paw-clear-filters" onClick={() => { setPawLogsFilter('All'); setPawLogsSearch(''); }}><i className="fas fa-times"></i> Clear filters</button>
                            )}
                          </div>

                          {/* Substitute Request Cards */}
                          {getFilteredPawSubs().length === 0 ? (
                            <div className="paw-empty-state">
                              <i className="fas fa-people-arrows"></i>
                              <h3>No Substitute Requests Found</h3>
                              <p>{pawLogsSearch || pawLogsFilter !== 'All' ? 'Try adjusting your search or filters.' : 'No substitute requests have been made yet.'}</p>
                            </div>
                          ) : (
                            <div className="paw-excuse-grid">
                              {getFilteredPawSubs().map(sub => {
                                const isPast = new Date(sub.schedule_date + 'T00:00:00') < new Date(new Date().toDateString());
                                const statusClass = sub.status === 'Pending Admin' ? 'pending' : sub.status === 'Open for Sub' ? 'open' : sub.status === 'Accepted' ? 'accepted' : sub.status.toLowerCase();
                                const statusLabel = sub.status === 'Pending Admin' ? 'Pending' : sub.status === 'Open for Sub' ? 'Open' : sub.status;
                                return (
                                  <div key={sub.id} className={`paw-excuse-card sub-card ${statusClass}${isPast ? ' past' : ''}`}>
                                    <div className="paw-excuse-card-top">
                                      <div className="paw-excuse-profile">
                                        <div className="paw-excuse-avatar" style={{ borderColor: '#9c27b0' }}>
                                          {sub.requester_profile_picture ? <img src={sub.requester_profile_picture} alt="" referrerPolicy="no-referrer" /> : <span>{getInitials(sub.requester_name)}</span>}
                                        </div>
                                        <div className="paw-excuse-user-info">
                                          <strong>{sub.requester_name}</strong>
                                          <span className="paw-excuse-role-tag" style={{ background: (sub.role_type || 'Song Leader') === 'Song Leader' ? 'rgba(146,108,21,0.1)' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? 'rgba(23,162,184,0.1)' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? 'rgba(111,66,193,0.1)' : 'rgba(232,62,140,0.1)', color: (sub.role_type || 'Song Leader') === 'Song Leader' ? '#926c15' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? '#17a2b8' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? '#6f42c1' : '#e83e8c' }}>
                                            <i className={`fas ${(sub.role_type || 'Song Leader') === 'Song Leader' ? 'fa-microphone' : (sub.role_type || 'Song Leader') === 'Backup Singer' ? 'fa-users' : (sub.role_type || 'Song Leader') === 'Instrumentalist' ? 'fa-guitar' : 'fa-shoe-prints'}`}></i> {sub.role_type || 'Song Leader'}
                                          </span>
                                        </div>
                                      </div>
                                      <span className={`paw-excuse-status ${statusClass}`}>{statusLabel}</span>
                                    </div>
                                    <div className="paw-excuse-card-body">
                                      <div className="paw-excuse-date-row">
                                        <i className="fas fa-calendar-day"></i>
                                        <span>{formatDate(sub.schedule_date)}</span>
                                        {isPast && <span className="paw-past-tag">Past</span>}
                                      </div>
                                      <p className="paw-excuse-reason-text"><i className="fas fa-quote-left"></i> {sub.reason}</p>
                                      {sub.substitute_name && (
                                        <div className="paw-sub-accepted-info">
                                          <i className="fas fa-user-check"></i> <strong>{sub.substitute_name}</strong> accepted this substitute request
                                        </div>
                                      )}
                                      {sub.reviewed_by && (
                                        <div className="paw-excuse-reviewer"><i className="fas fa-user-shield"></i> Reviewed by {sub.reviewed_by}</div>
                                      )}
                                      {sub.thank_you_sent && sub.thank_you_message && (
                                        <div className="paw-sub-thankyou-info"><i className="fas fa-heart"></i> Thank you: &ldquo;{sub.thank_you_message}&rdquo;</div>
                                      )}
                                    </div>
                                    <div className="paw-excuse-card-footer">
                                      <span className="paw-excuse-filed-time"><i className="fas fa-clock"></i> {new Date(sub.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                      {sub.status === 'Pending Admin' && (
                                        <div className="paw-excuse-card-actions">
                                          <button className="paw-action-sm approve" onClick={() => adminReviewSub(sub.id, 'approve')}><i className="fas fa-check"></i> Approve</button>
                                          <button className="paw-action-sm reject" onClick={() => adminReviewSub(sub.id, 'reject')}><i className="fas fa-times"></i> Reject</button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {/* ---- SONG LEADER: Excuse History (own excuses only) ---- */}
                  {!isAdmin && (
                    <>
                      <div className="paw-history-header">
                        <div className="paw-history-title">
                          <i className="fas fa-history"></i>
                          <h3>My Excuse &amp; Substitution History</h3>
                        </div>
                        <p className="paw-history-desc">Track all your filed excuses, substitute requests, and their status.</p>
                      </div>

                      {/* Mini Stats */}
                      <div className="paw-stats-row mini">
                        <div className="paw-stat-card pending">
                          <div className="paw-stat-icon"><i className="fas fa-clock"></i></div>
                          <div className="paw-stat-info">
                            <span className="paw-stat-num">{getMyExcuses().filter(e => e.status === 'Pending').length}</span>
                            <span className="paw-stat-label">Pending</span>
                          </div>
                        </div>
                        <div className="paw-stat-card approved">
                          <div className="paw-stat-icon"><i className="fas fa-check-circle"></i></div>
                          <div className="paw-stat-info">
                            <span className="paw-stat-num">{getMyExcuses().filter(e => e.status === 'Approved').length}</span>
                            <span className="paw-stat-label">Approved</span>
                          </div>
                        </div>
                        <div className="paw-stat-card sub-stat">
                          <div className="paw-stat-icon"><i className="fas fa-people-arrows"></i></div>
                          <div className="paw-stat-info">
                            <span className="paw-stat-num">{getMySubRequests().length}</span>
                            <span className="paw-stat-label">Sub Requests</span>
                          </div>
                        </div>
                      </div>

                      {/* My Sub Requests Section */}
                      {getMySubRequests().length > 0 && (
                        <div className="paw-sub-history-section">
                          <h4 className="paw-sub-history-title"><i className="fas fa-people-arrows"></i> My Substitute Requests</h4>
                          <div className="paw-excuse-grid">
                            {getMySubRequests().map(sub => {
                              const isPast = new Date(sub.schedule_date + 'T00:00:00') < new Date(new Date().toDateString());
                              return (
                                <div key={sub.id} className={`paw-excuse-card sub-card ${sub.status === 'Accepted' ? 'accepted' : sub.status === 'Open for Sub' ? 'open' : sub.status === 'Pending Admin' ? 'pending' : sub.status.toLowerCase()}${isPast ? ' past' : ''}`}>
                                  <div className="paw-excuse-card-top">
                                    <div className="paw-excuse-profile">
                                      <div className="paw-excuse-avatar" style={{ borderColor: '#9c27b0' }}>
                                        {userData?.profile_picture ? <img src={userData.profile_picture} alt="" referrerPolicy="no-referrer" /> : <span>{getInitials(`${userData?.firstname} ${userData?.lastname}`)}</span>}
                                      </div>
                                      <div className="paw-excuse-user-info">
                                        <strong>{userData?.firstname} {userData?.lastname}</strong>
                                        <span className="paw-excuse-role-tag" style={{ background: 'rgba(156,39,176,0.1)', color: '#9c27b0' }}>
                                          <i className="fas fa-people-arrows"></i> Sub Request
                                        </span>
                                      </div>
                                    </div>
                                    <span className={`paw-excuse-status ${sub.status === 'Pending Admin' ? 'pending' : sub.status === 'Open for Sub' ? 'open' : sub.status.toLowerCase()}`}>
                                      {sub.status === 'Pending Admin' ? 'Pending' : sub.status}
                                    </span>
                                  </div>
                                  <div className="paw-excuse-card-body">
                                    <div className="paw-excuse-date-row">
                                      <i className="fas fa-calendar-day"></i>
                                      <span>{formatDate(sub.schedule_date)}</span>
                                      {isPast && <span className="paw-past-tag">Past</span>}
                                    </div>
                                    <p className="paw-excuse-reason-text"><i className="fas fa-quote-left"></i> {sub.reason}</p>
                                    {sub.substitute_name && (
                                      <div className="paw-sub-accepted-info">
                                        <i className="fas fa-user-check"></i> Substituted by <strong>{sub.substitute_name}</strong>
                                      </div>
                                    )}
                                    {sub.admin_note && (
                                      <div className="paw-excuse-admin-note"><i className="fas fa-comment-dots"></i> <strong>Admin:</strong> {sub.admin_note}</div>
                                    )}
                                  </div>
                                  <div className="paw-excuse-card-footer">
                                    <span className="paw-excuse-filed-time"><i className="fas fa-clock"></i> {new Date(sub.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    {sub.status === 'Pending Admin' && !isPast && (
                                      <button className="paw-action-sm cancel" onClick={() => cancelSubRequest(sub.id)}><i className="fas fa-times"></i> Cancel</button>
                                    )}
                                    {sub.status === 'Accepted' && !sub.thank_you_sent && !isPast && (
                                      <button className="paw-action-sm thankyou" onClick={() => { setSubThankYouModal({ subId: sub.id, subName: sub.substitute_name }); setSubThankYouMessage(''); }}>
                                        <i className="fas fa-heart"></i> Thank You
                                      </button>
                                    )}
                                    {sub.thank_you_sent && (
                                      <span className="lu-sub-thankyou-sent"><i className="fas fa-check-circle"></i> Thanked</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Search + filter */}
                      <div className="paw-filters-bar">
                        <div className="paw-search-box">
                          <i className="fas fa-search"></i>
                          <input type="text" placeholder="Search by date or reason..." value={pawLogsSearch} onChange={(e) => setPawLogsSearch(e.target.value)} />
                          {pawLogsSearch && <button className="paw-search-clear" onClick={() => setPawLogsSearch('')}><i className="fas fa-times"></i></button>}
                        </div>
                        <div className="paw-filter-pills">
                          {['All', 'Pending', 'Approved', 'Rejected'].map(s => (
                            <button key={s} className={`paw-filter-pill ${pawLogsFilter === s ? 'active' : ''} ${s.toLowerCase()}`} onClick={() => setPawLogsFilter(s)}>{s}</button>
                          ))}
                        </div>
                      </div>

                      {/* My Excuse List */}
                      {(() => {
                        const myFiltered = getMyExcuses().filter(e => {
                          if (pawLogsFilter !== 'All' && e.status !== pawLogsFilter) return false;
                          if (pawLogsSearch.trim()) {
                            const q = pawLogsSearch.toLowerCase();
                            return e.reason?.toLowerCase().includes(q) || e.excuse_date?.includes(q) || (e.role_type || '').toLowerCase().includes(q);
                          }
                          return true;
                        });
                        return myFiltered.length === 0 ? (
                          <div className="paw-empty-state">
                            <i className="fas fa-clipboard-check"></i>
                            <h3>No Excuses Found</h3>
                            <p>{pawLogsSearch || pawLogsFilter !== 'All' ? 'Try adjusting your search or filter.' : 'You haven\'t filed any excuses yet. Go to the calendar and tap a free date to file one.'}</p>
                          </div>
                        ) : (
                          <div className="paw-excuse-grid">
                            {myFiltered.map(exc => {
                              const isPast = new Date(exc.excuse_date + 'T00:00:00') < new Date(new Date().toDateString());
                              const roleColor = PAW_ROLE_COLORS[exc.role_type || 'Song Leader'] || '#926c15';
                              return (
                                <div key={exc.id} className={`paw-excuse-card ${exc.status.toLowerCase()}${isPast ? ' past' : ''}`}>
                                  <div className="paw-excuse-card-top">
                                    <div className="paw-excuse-profile">
                                      <div className="paw-excuse-avatar" style={{ borderColor: roleColor }}>
                                        {userData?.profile_picture ? <img src={userData.profile_picture} alt="" referrerPolicy="no-referrer" /> : <span>{getInitials(`${userData?.firstname} ${userData?.lastname}`)}</span>}
                                      </div>
                                      <div className="paw-excuse-user-info">
                                        <strong>{userData?.firstname} {userData?.lastname}</strong>
                                        <span className="paw-excuse-role-tag" style={{ background: `${roleColor}15`, color: roleColor }}>
                                          <i className={`fas ${PAW_ROLE_ICONS[exc.role_type || 'Song Leader']}`}></i> {exc.role_type || 'Song Leader'}
                                        </span>
                                      </div>
                                    </div>
                                    <span className={`paw-excuse-status ${exc.status.toLowerCase()}`}>{exc.status}</span>
                                  </div>
                                  <div className="paw-excuse-card-body">
                                    <div className="paw-excuse-date-row">
                                      <i className="fas fa-calendar-day"></i>
                                      <span>{formatDate(exc.excuse_date)}</span>
                                      {isPast && <span className="paw-past-tag">Past</span>}
                                    </div>
                                    <p className="paw-excuse-reason-text"><i className="fas fa-quote-left"></i> {exc.reason}</p>
                                    {exc.admin_note && (
                                      <div className="paw-excuse-admin-note"><i className="fas fa-comment-dots"></i> <strong>Admin:</strong> {exc.admin_note}</div>
                                    )}
                                  </div>
                                  <div className="paw-excuse-card-footer">
                                    <span className="paw-excuse-filed-time"><i className="fas fa-clock"></i> {new Date(exc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    {exc.status === 'Pending' && !isPast && (
                                      <button className="paw-action-sm cancel" onClick={() => cancelExcuse(exc.id)}><i className="fas fa-times"></i> Cancel</button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}
            </section>
          )}

        </main>
      </div>
    </div>
  );
}
