// Usage: node --env-file=.env scripts/fetch-match-events.mjs

import {findWorldCupFixtureAndEvents} from './lib/api-football.mjs';

const {fixture, events} = await findWorldCupFixtureAndEvents();

console.log(`League: World Cup`);
console.log(
  `Fixture: ${fixture.teams.home.name} ${fixture.goals.home}-${fixture.goals.away} ` +
    `${fixture.teams.away.name} (id=${fixture.fixture.id})`,
);
console.log(JSON.stringify(events, null, 2));
