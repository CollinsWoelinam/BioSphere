import 'dart:async';

import 'package:flutter/material.dart';

import 'app_state.dart';
import 'data/sighting_store.dart';
import 'data/species_guide.dart';
import 'screens/guide_screen.dart';
import 'screens/log_sighting_screen.dart';
import 'screens/login_screen.dart';
import 'screens/map_screen.dart';
import 'screens/queue_screen.dart';
import 'screens/settings_screen.dart';
import 'services/auth_service.dart';
import 'services/location_service.dart';
import 'services/settings.dart';
import 'services/sync_service.dart';
import 'theme.dart';

Future<void> main() => runBioSphere();

/// App entry point. [location] can be replaced in end-to-end tests, where the
/// simulator's OS permission dialog cannot be answered programmatically.
Future<void> runBioSphere({LocationService? location}) async {
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
    location: location ?? LocationService(),
  );
  await state.init();
  unawaited(state.sync.start());
  runApp(AppScope(state: state, child: const BioSphereFieldApp()));
}

class BioSphereFieldApp extends StatelessWidget {
  const BioSphereFieldApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BioSphere Field',
      theme: bioTheme(Brightness.light),
      darkTheme: bioTheme(Brightness.dark),
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
        // Lives on the shell's Scaffold (not the map's) so it moves up above the
        // "Sighting saved" snack bar instead of being covered by it.
        floatingActionButton: _tab == 0
            ? FloatingActionButton.extended(
                heroTag: 'log',
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LogSightingScreen())),
                icon: const Icon(Icons.add_location_alt_outlined),
                label: const Text('Log sighting'),
              )
            : null,
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          destinations: [
            const NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Map'),
            NavigationDestination(
              icon: Badge(
                isLabelVisible: app.sync.pending > 0,
                backgroundColor: BioColors.of(context).warn,
                label: Text('${app.sync.pending}'),
                child: const Icon(Icons.cloud_upload_outlined),
              ),
              selectedIcon: Badge(
                isLabelVisible: app.sync.pending > 0,
                backgroundColor: BioColors.of(context).warn,
                label: Text('${app.sync.pending}'),
                child: const Icon(Icons.cloud_upload),
              ),
              label: 'Queue',
            ),
            const NavigationDestination(icon: Icon(Icons.menu_book_outlined), selectedIcon: Icon(Icons.menu_book), label: 'Guide'),
            const NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
          ],
        ),
      ),
    );
  }
}
