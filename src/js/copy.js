/**
 * copy.js — every word the player reads.
 *
 * Kept in one file on purpose: the wording is the difference between a
 * confusing toy and a game people pass around, and it should be editable
 * without going anywhere near the audio code.
 *
 * The naming problem this deck exists to solve: steps 2 and 4 are both "play
 * something backwards", and calling them both PLAY BACKWARDS — as the original
 * app did — makes the game unreadable. Step 2 is the puzzle. Step 4 is the
 * answer. The labels have to say so.
 */

import { PROMPT_PHRASES } from './phrases.js';

export const COPY = {
  appName: 'Sdrawkcab',
  tagline: 'Say a thing. Hear it backwards. Say THAT. Hear it backwards again.',

  steps: [
    {
      stepName: 'Say something',
      buttonLabel: 'Say It Forwards',
      buttonLabelActive: 'Listening… tap to stop',
      buttonLabelDone: 'Hear it again',
      helperText: 'Say a short phrase out loud, like a normal person. This is the easy bit.',
      doneToast: 'Got it. Beautiful work.',
    },
    {
      stepName: 'Hear the gibberish',
      buttonLabel: 'Hear The Gibberish',
      buttonLabelActive: 'Playing…',
      buttonLabelDone: 'Hear it again',
      helperText: 'That is your voice, backwards. It sounds wrong. It is meant to. Memorise the nonsense.',
      doneToast: 'Nonsense delivered.',
    },
    {
      stepName: 'Copy the gibberish',
      buttonLabel: 'Now You Say It',
      buttonLabelActive: 'Listening… tap to stop',
      buttonLabelDone: 'Hear your attempt',
      helperText: 'Make those exact weird noises back. Commit. Confidence beats accuracy.',
      doneToast: 'Extraordinary sounds. Truly.',
    },
    {
      stepName: 'The big flip',
      buttonLabel: 'Flip It Back',
      buttonLabelActive: 'Playing…',
      buttonLabelDone: 'Play it again',
      helperText: 'We reverse YOUR gibberish. If you nailed it, your phrase walks back out.',
      doneToast: 'And there it is.',
    },
  ],

  scoreTiers: [
    { minScore: 0, title: 'Glorious Nonsense', quip: 'Not one recognisable word. Genuinely impressive in its own way.' },
    { minScore: 30, title: 'Confident Gibberish', quip: 'Something was in there. We are choosing to believe it was a word.' },
    { minScore: 45, title: 'Backwards Apprentice', quip: 'The shape was right. The sounds were freelancing.' },
    { minScore: 60, title: 'Fluent In Nonsense', quip: 'That is a real attempt. Your mouth is learning.' },
    { minScore: 75, title: 'Reverse Talker', quip: 'Suspiciously good. Do you do this professionally?' },
    { minScore: 88, title: 'Backwards Wizard', quip: 'Your phrase came home. Play this one back for people.' },
    { minScore: 96, title: 'Unholy Mouth', quip: 'That should not be possible with a human tongue.' },
  ],

  promptPhrases: PROMPT_PHRASES,

  microcopy: {
    phraseLabel: 'Try saying',
    warmingUp: 'Getting ready…',
    playing: 'Playing…',
    playForward: 'Hear it forwards',
    slower: 'Play it slower',
    redo: 'Redo this bit',
    goAgain: 'Go again',
    shareButton: 'Share with your friends',
    shareText: 'I scored {score} trying to talk backwards. Beat that.',
    downloaded: 'Saved. Send it to someone.',
    copied: 'Copied',
    resultKicker: 'The verdict',
    streak: 'Best {best} · {rounds} round{s} played',
    tooQuiet: "We couldn't hear that one. Try again, louder.",
    silentSwitch: 'Hearing nothing? Check the silent switch on the side of your phone, and turn the volume up.',
    interrupted: 'Something interrupted that take. Give it another go.',
    suspicious: 'That was flawless. Suspiciously flawless. We are watching you.',
    howToPlay: [
      '<strong>Say a short phrase</strong> out loud. Two or three words.',
      '<strong>Listen to it backwards.</strong> It will sound like alien nonsense.',
      '<strong>Say the nonsense back</strong> as accurately as your mouth allows.',
      '<strong>We flip your nonsense around.</strong> If you got it right, your phrase comes back out.',
    ],
    errors: {
      'too-short': 'That was over before it started. Hold on a moment longer.',
      silent: "We couldn't hear anything. Get a bit closer to the mic.",
      busy: 'Something else is using the microphone. Close it and try again.',
      session: 'The audio got tangled up. Reload the page and it should behave.',
      interrupted: 'Something interrupted that take. Give it another go.',
      aborted: 'That take got cut off. Try again.',
      unknown: 'The microphone had a moment. Try that again.',
    },
  },

  blockers: {
    denied: {
      title: 'We need the microphone',
      body: 'The whole game is your voice, so there is not much to do without it. Allow microphone access in your browser settings and reload the page.',
    },
    'no-mic': {
      title: 'No microphone found',
      body: 'Your device is not offering a microphone. Plug one in, or try this on your phone.',
    },
    insecure: {
      title: 'Needs a secure connection',
      body: 'Browsers only hand out the microphone over https. Open this page on its https address and it will work.',
    },
    unsupported: {
      title: 'This browser will not play along',
      body: 'This looks like an in-app browser, which usually cannot record. Tap the ••• menu and choose "Open in Safari" or "Open in Chrome".',
    },
    unknown: {
      title: 'Something went wrong',
      body: 'The microphone could not be opened. Reloading the page usually sorts it out.',
    },
  },
};
