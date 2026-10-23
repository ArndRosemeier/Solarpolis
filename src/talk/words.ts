/**
 * The English words for what Solarpolis residents care about (`PURSUITS`, sim/voices.ts), given to the conversation
 * engine's English module: what a pursuit is called ("I've been thinking about …") and why someone likes it. The
 * reasons speak of this world (world bible): letters that cross the light-lag, ships at the dock, halls grown from
 * living trees, the curve of the land overhead. Per pursuit, never per person: the engine makes each voice.
 */
import type { Pursuit } from '../sim';

export const PURSUIT_WORDS: Readonly<Record<Pursuit, { name: string; reasons: string[] }>> = {
  orchard_keeping: { name: 'orchard keeping', reasons: ['I like watching things grow at their own pace.', 'There’s something calming about tending trees.', 'An old tree remembers every pruning.'] },
  cooking: { name: 'cooking', reasons: ['Fruit tastes best on the day it’s picked.', 'A meal is the easiest way to gather people.', 'I like to cook for whoever turns up.'] },
  hiking: { name: 'hiking', reasons: ['I enjoy seeing what’s beyond the next bend.', 'The wild end feels bigger every time I go.', 'It helps me slow my thoughts down.'] },
  music: { name: 'music', reasons: ['It gives my thoughts somewhere to go.', 'Playing with others is a kind of listening.', 'A tune carries further than you’d think in here.'] },
  dancing: { name: 'dancing', reasons: ['My feet think better than I do.', 'Dancing is talking without the words.', 'A good dance leaves everyone a little lighter.'] },
  games: { name: 'games on the commons', reasons: ['A good game makes friends of strangers for an hour.', 'I like a game where nobody knows the rules yet.', 'Losing well is a skill too.'] },
  stargazing: { name: 'stargazing', reasons: ['I like having something distant to wonder about.', 'Every point of light out there is some kind of story.', 'It makes the habitat feel small in a good way.'] },
  swimming: { name: 'swimming', reasons: ['The lake holds you up and asks nothing.', 'The water is never quite the same twice.', 'I think best floating on my back.'] },
  water_gardens: { name: 'the water gardens', reasons: ['The ponds change every hour with the light.', 'Reeds are more patient than people.', 'I like keeping water clear and alive.'] },
  woodwork: { name: 'woodwork', reasons: ['Wood tells you how it wants to be cut.', 'I like a thing you can use every day.', 'The bench smells better than anywhere else.'] },
  pottery: { name: 'pottery', reasons: ['Clay forgives a lot if you’re patient.', 'I like a bowl that shows the hand that made it.', 'The kiln always has the last word.'] },
  stonework: { name: 'stonework', reasons: ['Stone keeps its shape longer than any of us.', 'Laying a wall is slow, and that suits me.', 'A good stone finds its own place.'] },
  meadow_tending: { name: 'tending the meadows', reasons: ['A meadow looks wild, but it needs quiet care.', 'I like knowing which flowers come next.', 'The grass grows back, so there’s always more to do.'] },
  grown_halls: { name: 'training the grown halls', reasons: ['A hall takes a lifetime to grow, and that suits me.', 'You guide a tree; you never force it.', 'I like a roof that’s still alive.'] },
  wood_pasture: { name: 'the wood pastures', reasons: ['The deer know the pastures better than we do.', 'Open ground and old trees: I need both.', 'I like land that’s shared with animals.'] },
  wild_things: { name: 'watching the wild things', reasons: ['The squirrels have opinions about everyone.', 'If you sit still long enough, the deer come close.', 'I like the land when it forgets we’re here.'] },
  painting: { name: 'painting', reasons: ['I paint the land curving up overhead; it never looks real.', 'Light in here is never quite the same twice.', 'Painting makes me look properly.'] },
  sunwalk: { name: 'the Sunwalk', reasons: ['Walking with the light makes a day feel very long.', 'You meet everyone on the Sunwalk sooner or later.', 'I like a walk that never has to end.'] },
  letters: { name: 'writing letters', reasons: ['A reply from the outer system takes hours, so every word counts.', 'I like a letter that has to cross the light-lag.', 'Writing slowly makes me say what I mean.'] },
  ships: { name: 'watching the ships come in', reasons: ['I like guessing where each ship has been.', 'Every sail out there was pushed by some array.', 'Arrivals are the best part of any day.'] },
  history: { name: 'the habitat’s history', reasons: ['I like knowing who shaped the land before us.', 'Every grove here was somebody’s idea once.', 'The old records are full of arguments.'] },
  flying: { name: 'flying', reasons: ['Everything looks calmer from up near the axis.', 'Up high you can feel the habitat turn.', 'The air near the sunline is warm and quiet.'] },
};
