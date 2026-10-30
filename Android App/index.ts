import { registerRootComponent } from 'expo';
import App from './App';
import { installStructuredClone } from './src/lib/structured-clone';

// Hermes has no structuredClone; the inspection outbox copies its records with it.
installStructuredClone();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and sets up the Expo environment appropriately for both dev and production.
registerRootComponent(App);
