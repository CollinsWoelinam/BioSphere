import 'dart:async';

import 'package:flutter/material.dart';

import 'app_state.dart';
import 'data/sighting_store.dart';
import 'data/species_guide.dart';
import 'screens/guide_screen.dart';
import 'screens/login_screen.dart';
import 'screens/map_screen.dart';
import 'screens/queue_screen.dart';
import 'screens/settings_screen.dart';
import 'services/auth_service.dart';
import 'services/location_service.dart';
import 'services/settings.dart';
import 'services/sync_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settings = await Settings.load();
  final store = await SightingStore.open();
  final auth = AuthService();
  await auth.load();
  final state = AppState(
    store: store,
    settings: settings,
    auth: auth,
    sync: SyncService(store, settings, auth),
    guide: await SpeciesGuide.load(),
    location: LocationService(),
  );
  await state.init();
  unawaited(state.sync.start());
  runApp(AppScope(state: state, child: const BioSphereFieldApp()));
}

class BioSphereFieldApp extends StatelessWidget {
  const BioSphereFieldApp({super.key});

  @override
  Widget build(BuildContext context) {
    ThemeData theme(Brightness b) => ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2E6B3A), brightness: b),
          useMaterial3: true,
        );
    return MaterialApp(
      title: 'BioSphere Field',
      theme: theme(Brightness.light),
      darkTheme: theme(Brightness.dark),
      home: const _AuthGate(),
    );
  }
}

/// Signing in needs a connection once; after that the app works offline for the token's lifetime.
class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    final auth = AppScope.of(context).auth;
    return ListenableBuilder(
      listenable: auth,
      builder: (context, _) => auth.session == null ? const LoginScreen() : const HomeShell(),
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    return ListenableBuilder(
      listenable: app.sync,
      builder: (context, _) => Scaffold(
        body: IndexedStack(
          index: _tab,
          children: const [MapScreen(), QueueScreen(), GuideScreen(), SettingsScreen()],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          destinations: [
            const NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Map'),
            NavigationDestination(
              icon: Badge(
                isLabelVisible: app.sync.pending > 0,
                label: Text('${app.sync.pending}'),
                child: const Icon(Icons.list_alt_outlined),
              ),
              selectedIcon: const Icon(Icons.list_alt),
              label: 'Sightings',
            ),
            const NavigationDestination(icon: Icon(Icons.menu_book_outlined), selectedIcon: Icon(Icons.menu_book), label: 'Guide'),
            const NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
          ],
        ),
      ),
    );
  }
}
