import 'package:flutter/material.dart';

import '../models.dart';

/// Modal dialog: pick a staff member then enter PIN.
/// Calls [onVerify] to check the PIN; pops with the [StaffItem] on success.
class StaffPinDialog extends StatefulWidget {
  const StaffPinDialog({
    required this.staffList,
    required this.onVerify,
    this.preSelected,
  });

  final List<StaffItem> staffList;
  final StaffItem? preSelected;
  final Future<bool> Function(int staffId, String pin) onVerify;

  @override
  State<StaffPinDialog> createState() => _StaffPinDialogState();
}

class _StaffPinDialogState extends State<StaffPinDialog> {
  late StaffItem _selected;
  final _pinController = TextEditingController();
  bool _verifying = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _selected = widget.preSelected != null &&
            widget.staffList.any((s) => s.id == widget.preSelected!.id)
        ? widget.staffList.firstWhere((s) => s.id == widget.preSelected!.id)
        : widget.staffList.first;
  }

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    final pin = _pinController.text.trim();
    if (pin.isEmpty) {
      setState(() => _error = 'Enter PIN');
      return;
    }

    setState(() {
      _verifying = true;
      _error = null;
    });

    try {
      final valid = await widget.onVerify(_selected.id, pin);
      if (!mounted) return;
      if (valid) {
        Navigator.of(context).pop(_selected);
      } else {
        setState(() {
          _error = 'Incorrect PIN. Try again.';
          _verifying = false;
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _verifying = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Operator verification'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<StaffItem>(
            value: _selected,
            decoration: const InputDecoration(labelText: 'Staff member'),
            items: widget.staffList
                .map(
                  (s) => DropdownMenuItem<StaffItem>(
                    value: s,
                    child: Text('${s.name} (${s.role})'),
                  ),
                )
                .toList(),
            onChanged: _verifying
                ? null
                : (value) {
                    if (value != null) {
                      setState(() {
                        _selected = value;
                        _error = null;
                        _pinController.clear();
                      });
                    }
                  },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _pinController,
            obscureText: true,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'PIN'),
            onSubmitted: _verifying ? null : (_) => _confirm(),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(color: Colors.red, fontSize: 13)),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: _verifying ? null : () => Navigator.of(context).pop(null),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _verifying ? null : _confirm,
          child: _verifying
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Confirm'),
        ),
      ],
    );
  }
}
