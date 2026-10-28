import 'package:flutter/material.dart';

import '../app_state.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _form = GlobalKey<FormState>();
  late final _server = TextEditingController(text: AppScope.of(context).settings.apiUrl);
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _register = false;
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    final app = AppScope.of(context);
    app.settings.apiUrl = _server.text;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_register) {
        await app.auth.register(app.settings.apiUrl, _name.text.trim(), _email.text.trim(), _password.text);
      } else {
        await app.auth.login(app.settings.apiUrl, _email.text.trim(), _password.text);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    for (final c in [_server, _name, _email, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Icon(Icons.eco, size: 48, color: scheme.primary),
                  const SizedBox(height: 12),
                  Text('BioSphere Field', style: t.headlineSmall, textAlign: TextAlign.center),
                  Text(
                    _register ? 'Create a citizen scientist account' : 'Sign in to log and sync sightings',
                    style: t.bodyMedium?.copyWith(color: scheme.outline),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  if (_register) ...[
                    TextFormField(
                      controller: _name,
                      decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder()),
                      validator: (v) => (v ?? '').trim().isEmpty ? 'Enter your name' : null,
                    ),
                    const SizedBox(height: 12),
                  ],
                  TextFormField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
                    validator: (v) => (v ?? '').contains('@') ? null : 'Enter a valid email',
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder()),
                    validator: (v) =>
                        _register && (v ?? '').length < 10 ? 'At least 10 characters' : ((v ?? '').isEmpty ? 'Enter your password' : null),
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: TextStyle(color: scheme.error)),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    child: Text(_busy ? 'Please wait…' : (_register ? 'Create account' : 'Sign in')),
                  ),
                  TextButton(
                    onPressed: () => setState(() => _register = !_register),
                    child: Text(_register ? 'Already have an account? Sign in' : 'New citizen scientist? Create an account'),
                  ),
                  const SizedBox(height: 8),
                  ExpansionTile(
                    title: const Text('Server'),
                    subtitle: Text(_server.text, maxLines: 1, overflow: TextOverflow.ellipsis),
                    children: [
                      TextField(
                        controller: _server,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(labelText: 'BioSphere API URL', border: OutlineInputBorder()),
                        onChanged: (_) => setState(() {}),
                      ),
                      const SizedBox(height: 8),
                    ],
                  ),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
