/**
 * phrases.js — the suggestions that appear above the record button.
 *
 * Every entry has to survive being said, reversed, imitated and reversed again,
 * so the bar is narrow: four words at most, chunky separable sounds, and funny
 * out loud rather than funny on paper. Long or mushy phrases smear into noise
 * when reversed and make a round miserable, which is the whole reason for the
 * length cap.
 *
 * tests/phrases.test.mjs enforces the rules — length, character set, duplicates
 * including reordered pairs, and a variety check so no single word can take
 * over the list. Add freely; the test will tell you if an entry does not fit.
 */
export const PROMPT_PHRASES = [
  'cat bagpipes', 'boat goat', 'pumpkin pants', 'jet pack duck', 'crab boss',
  'badger chef', 'snail sheriff', 'cookie bandit', 'cabbage gossip', 'colander hat',
  'toast ghost', 'sock monster', 'ogre kazoo', 'dragon hiccup', 'polite skeleton',
  'magic mop', 'cupcake catapult', 'waffle goggles', 'pug in a mug', 'bucket of bees',
  'big bad bagel', 'duck taxi', 'frog picnic', 'hedgehog tuba', 'spider socks',
  'compost disco', 'tadpole choir', 'robot pancake', 'beep boop taco', 'escaped grape',
  'duck deputy', 'smug toad', 'bat butler', 'otter judge', 'skunk captain',
  'moth landlord', 'hamster duke', 'picky puffin', 'shark dentist', 'grumpy gecko',
  'moose coach', 'bee bouncer', 'pig postman', 'sheep skipper', 'hedgehog cop',
  'proud penguin', 'fox doctor', 'smug biscuit', 'bagel heist', 'muffin mutiny',
  'butter thief', 'ketchup alibi', 'feral meatball', 'burger meltdown', 'eggs on strike',
  'sneaky teapot', 'spatula duel', 'napping fridge', 'keys in freezer', 'bag of bags',
  'greedy sofa', 'cable spaghetti', 'cuckoo panic', 'table leg ambush', 'laundry chair',
  'bucket gossip', 'dust bunny gang', 'smoke alarm chirp', 'ghost pigeon', 'tuba ghost',
  'cactus ghost', 'spooky biscuit', 'haunted kettle', 'damp wizard', 'bog witch',
  'witch bus', 'hex a pickle', 'broom garage', 'pocket goblin', 'goblin taxi',
  'gremlin brunch', 'monster picnic', 'yeti sweater', 'crypt puppy', 'pumpkin panic',
  'tiny hex', 'crab tuba', 'corn cob cap', 'potato puppet', 'picnic panic',
  'ketchup cactus', 'biscuit bandit', 'teapot goblin', 'bug banjo', 'big pig wig',
  'pancake pocket', 'toad in a hat', 'cabbage cannon', 'tap dancing pug', 'pop up toad',
  'bongo badger', 'tugboat cookie', 'cactus cop', 'pelican taco', 'cricket packet',
  'coconut kazoo', 'hedgehog pocket', 'mud pancake', 'snail commute', 'duck debate',
  'toad tuxedo', 'acorn helmet', 'wasp opera', 'newt yodel', 'turnip banjo',
  'space bucket', 'comet biscuit', 'laser potato', 'moon cactus', 'robot tuba',
  'space walrus', 'robot picnic', 'clockwork duck', 'robot hiccup', 'cog soup',
  'robot yoga', 'nervous forklift', 'cosmic goose', 'sniff the milk', 'left to soak',
  'chipped mug', 'reply all panic', 'still on mute', 'microwave fish', 'sad desk plant',
  'unexpected item', 'puddle sock', 'goat banker', 'bossy newt', 'clam critic',
  'wombat pilot', 'fussy ferret', 'goose guard', 'hippo teacher', 'squid baron',
  'angry ant', 'bitter pickle', 'taco tantrum', 'pancake crime', 'pretzel panic',
  'sneaky dumpling', 'rude custard', 'bossy pudding', 'haunted cupcake', 'cursed toast',
  'pumpkin protest', 'popcorn revolt', 'grumpy coffee', 'sausage sabotage', 'naughty nacho',
  'apple ambush', 'smug cupboard', 'lid clatter', 'crusty sponge', 'bin bag split',
  'wonky picture', 'rug trip', 'squeaky hinge', 'cursed doorknob', 'blanket theft',
  'crumbs in bed', 'soap escape', 'clingy curtain', 'spooky hamster', 'cursed bucket',
  'frog wizard', 'wizard hot tub', 'wizard nap', 'toad potion', 'goblin dentist',
  'grumpy goblin', 'swamp muffin', 'duck cabinet', 'kazoo boots', 'octopus cup',
  'muffin bucket', 'bathtub gopher', 'puffin pudding', 'pickle hiccup', 'bubble tuba',
  'beetle boots', 'twig sandwich', 'slug jacket', 'fog dumpling', 'moth blanket',
  'garden goblin', 'fern haircut', 'sap goggles', 'nettle jazz', 'lizard tango',
  'cabbage rocket', 'frost muffin', 'rocket pickle', 'cosmic donut', 'moon buggy',
  'robot dentist', 'planet snack', 'space kazoo', 'moon spaghetti', 'space octopus',
  'comet cabbage', 'clanky robot', 'rocket socks', 'space badger', 'moon truck',
  'buzzing kettle', 'space pudding', 'burnt toast', 'broken biscuit', 'last teabag',
  'crumbs in butter', 'one clean fork', 'stuck jam lid', 'paper jam', 'leaky pen',
  'exact change', 'lift small talk', 'awkward wave', 'dino bath time', 'tiny mammoth',
  'pirate ballet', 'kayak lemur', 'peg leg pigeon', 'cheese trombone', 'camel cardigan',
  'ping pong panda', 'judo koala', 'bowling turkey', 'hopscotch mole', 'tornado in a jar',
  'leaky tent', 'sleepy tractor', 'hen on a moped', 'blimp parade', 'top hat trout',
  'cow in slippers', 'lobster lifeguard', 'two left boots', 'sandy sandwich', 'trolley wobble',
];
