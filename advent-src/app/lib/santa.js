'use strict';
// Santa's letters desk: a scripted, kind, Christ-centered Santa who never says anything he shouldn't.
// Replies are chosen by simple keyword rules so they work with no AI and no internet.

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

function hashOf(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const WISH_RE = /\b(i want|i would like|i'd like|i wish|wish for|please bring|bring me|can i have|could i have|i really want|get me|my list|for christmas i|i hope i get|i'm hoping for|im hoping for)\b/i;
const QUESTION_WORDS = /\b(who|what|where|when|why|how|do you|are you|is it|can you|will you|did you)\b/i;

function cleanWish(text) {
  let t = text.replace(WISH_RE, '').replace(/\b(for christmas|this year|please|santa|dear santa|a|an|the|some)\b/gi, ' ').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  if (t.length > 80) t = t.slice(0, 77) + '…';
  return t;
}

function reply({ text, child, listStatus, daysLeft, wishesCount }) {
  const t = String(text || '').trim();
  const low = t.toLowerCase();
  const seed = hashOf(low + child.name);
  const name = child.name;
  const out = { text: '', wish: null };

  if (!t) { out.text = `Ho ho ho! Say something, ${name}, the elves are listening!`; return out; }

  if (/\b(hi|hello|hey|howdy|good morning|good night|goodnight|merry christmas)\b/.test(low) && low.length < 40) {
    out.text = pick([
      `Ho ho ho! Hello there, ${name}! Mrs. Claus just took a tray of cookies out of the oven. What's on your mind?`,
      `Well hello, ${name}! It is a frosty ${daysLeft > 0 ? daysLeft + '-sleeps-to-go' : 'Christmas'} kind of day up here at the North Pole.`,
      `Merry Christmas, ${name}! The reindeer say hello too. Blitzen says it twice.`,
    ], seed);
    return out;
  }
  if (/\b(nice list|naughty list|naughty or nice|am i (on the )?(nice|naughty|good)|have i been good|was i good)\b/.test(low)) {
    out.text = listStatus === 'naughty'
      ? `Hmm, ${name}. I just checked my list, and today you are on the Naughty side. But ho ho ho, the day isn't over! Kind words and a helping hand can move a name faster than Dasher can fly. I'll check again tomorrow.`
      : `I checked my list twice, ${name}, and today your name is on the NICE list in big gold letters! Keep it up. Being kind is the best gift you can give.`;
    return out;
  }
  if (/\b(rudolph|red nose)\b/.test(low)) { out.text = `Rudolph is doing great, ${name}! His nose is so bright this year that the elves use it to read bedtime stories. He is practicing his takeoffs over the frozen lake right now.`; return out; }
  if (/\b(reindeer|dasher|dancer|prancer|vixen|comet|cupid|donner|donder|blitzen)\b/.test(low)) {
    out.text = pick([
      `The reindeer are in fine form, ${name}! Dasher, Dancer, Prancer, Vixen, Comet, Cupid, Donner, Blitzen, and of course Rudolph. They eat a LOT of carrots and the occasional candy cane when nobody is looking.`,
      `Ho ho ho! Comet is the fastest, Cupid is the sweetest, and Blitzen snores the loudest. Would you leave a carrot or two out on Christmas Eve, ${name}? They'd love that.`,
    ], seed);
    return out;
  }
  if (/\b(elf|elves)\b/.test(low)) { out.text = `My elves are the busiest little helpers in the world, ${name}. Right now they are ${daysLeft > 10 ? 'building toys and painting wagons' : daysLeft > 1 ? 'wrapping presents as fast as they can' : 'loading the sleigh'}! Jingle, my head elf, says hello.`; return out; }
  if (/\b(mrs\.? claus|your wife)\b/.test(low)) { out.text = `Mrs. Claus is wonderful, ${name}. She bakes, she sews the elves' hats, and she reminds me to wear my scarf. She says you should wear yours too!`; return out; }
  if (/\b(cookie|cookies|milk|snack|carrot)\b/.test(low)) { out.text = `Cookies! Ho ho ho, ${name}, now you're speaking my language. Chocolate chip is my favorite, but honestly I have never met a cookie I didn't like. A glass of milk and a carrot for the reindeer would be very kind.`; return out; }
  if (/\b(how old|your age|birthday)\b/.test(low) && !/jesus/.test(low)) { out.text = `How old am I? Older than the tallest pine tree and younger than the stars, ${name}! Let's just say I've had a lot of Christmases. The most important birthday at Christmas isn't mine, though. It's Jesus'!`; return out; }
  if (/\b(jesus|god|bible|church|manger|bethlehem|real meaning|true meaning|why (do we )?celebrate)\b/.test(low)) {
    out.text = pick([
      `That is the best question of all, ${name}. Christmas is Jesus' birthday! Long ago God sent His Son to be born in a little town called Bethlehem, because He loves us. I give presents to remember the greatest gift ever given. Remember to say happy birthday to Jesus on Christmas morning!`,
      `Ho ho ho, you have a wise heart, ${name}. Everything I do is a little picture of God's giving. The angels told the shepherds "Fear not, for behold, I bring you good tidings of great joy." That joy is what Christmas is really about.`,
    ], seed);
    return out;
  }
  if (/\b(are you real|you real|is santa real|do you exist)\b/.test(low)) { out.text = `Ho ho ho! ${name}, I am as real as the kindness in your heart and the giving in your hands. The spirit of Christmas is very, very real. Now, what shall we talk about next?`; return out; }
  if (/\b(where do you live|north pole|your house|workshop)\b/.test(low)) { out.text = `I live at the North Pole, ${name}, where the snow never melts and the northern lights dance every night. You can peek at my workshop on the North Pole Cams any time!`; return out; }
  if (/\b(chimney|how do you get in|fireplace|no chimney)\b/.test(low)) { out.text = `Chimneys, doors, windows... ho ho ho, a little Christmas magic goes a long way, ${name}. Don't you worry about that part. Just be fast asleep!`; return out; }
  if (/\b(sleep|bed|asleep|awake|stay up|see you)\b/.test(low)) { out.text = `I only visit houses where the children are fast asleep, ${name}. The reindeer are shy! So on Christmas Eve, brush your teeth, say your prayers, and close those eyes tight.`; return out; }
  if (/\b(joke|funny|laugh)\b/.test(low)) {
    out.text = pick([
      `What do you call an elf who sings? A wrapper! Ho ho ho!`,
      `What do snowmen eat for breakfast? Frosted flakes! Ho ho ho!`,
      `Why was the little Christmas tree bad at sewing? It kept dropping its needles! Ho ho ho!`,
      `What do you get when you cross a snowman and a dog? Frostbite! Ho ho ho!`,
      `What is a reindeer's favorite game? Stable tennis! Ho ho ho!`,
    ], seed);
    return out;
  }
  if (/\b(thank|thanks|love you|you're the best|youre the best)\b/.test(low)) { out.text = `Aww, ${name}. That warms my heart more than a cup of Mrs. Claus's cocoa. I love you too. Be good, be kind, and give someone a hug today.`; return out; }
  if (/\b(cold|snow|weather|freezing)\b/.test(low)) { out.text = `It is minus forty at the North Pole today, ${name}, which the polar bears call "a bit nippy." The elves wear three pairs of socks. How is the weather where you are?`; return out; }
  if (/\b(school|homework|teacher)\b/.test(low)) { out.text = `School is important, ${name}! Even the elves go to Toy-Making School. Listening to your teacher and doing your best is exactly the kind of thing that keeps names on the Nice list.`; return out; }
  if (/\b(brother|sister|mom|dad|mommy|daddy|grandma|grandpa|family)\b/.test(low)) { out.text = `Family is the best part of Christmas, ${name}. Give them an extra hug from me. And maybe help clear the table without being asked. The elves tell me that one works wonders.`; return out; }
  if (/\b(sorry|i was bad|i did something|made a mistake)\b/.test(low)) { out.text = `Everyone makes mistakes, ${name}. What matters is saying sorry and trying again, and you just did the first part. I am proud of you.`; return out; }

  if (WISH_RE.test(low) || (/\b(lego|doll|bike|bicycle|game|puppy|kitten|toy|truck|book|nintendo|switch|xbox|playstation|barbie|dress|boots|phone|tablet|scooter|art|paint|drum|guitar)\b/.test(low) && !QUESTION_WORDS.test(low))) {
    const wish = cleanWish(t);
    if (wish) {
      out.wish = wish;
      out.text = pick([
        `Got it, ${name}! I've written "${wish}" on my list with my special gold pen. The elves will see what they can do. Anything else?`,
        `"${wish}", you say? Ho ho ho, noted! I'll make sure the elves read that one twice. What else is on your mind?`,
        `The elves just cheered, ${name}! "${wish}" is on your list now. ${wishesCount >= 4 ? 'That is a good long list. Remember, the best gifts are not always things!' : 'Anything else you are hoping for?'}`,
      ], seed);
      return out;
    }
  }
  if (QUESTION_WORDS.test(low)) {
    out.text = pick([
      `Ho ho ho, that's a good question, ${name}! Even Santa doesn't know everything. But I do know this: you are loved, and Christmas is coming.`,
      `Hmm, let me ask the elves... They say "ask your mom and dad!" Ho ho ho! They are usually right.`,
      `A curious mind is a wonderful thing, ${name}. Keep asking questions, and keep being kind.`,
    ], seed);
    return out;
  }
  out.text = pick([
    `Ho ho ho! Thank you for telling me, ${name}. Is there anything you'd like on your Christmas list? Just say "I would like..." and I'll write it down.`,
    `I hear you, ${name}! The elves are nodding. ${daysLeft > 0 ? 'Only ' + daysLeft + ' more sleep' + (daysLeft === 1 ? '' : 's') + ' until Christmas!' : 'Merry Christmas!'}`,
    `Wonderful, ${name}. Remember, every day is a chance to be kind. Would you like to hear a joke, or tell me what's on your list?`,
  ], seed);
  return out;
}

module.exports = { reply, cleanWish };
