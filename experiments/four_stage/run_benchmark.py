"""Compare the shipped tool agent with a four-stage ProDebugger reasoner.

Run this file directly or as ``python -m experiments.four_stage.run_benchmark``.
Pass ``--skip-baseline`` to run only the four-stage reasoner.
Gold labels are read only after the enabled diagnosis arms have finished.
"""

if __package__:
    from .benchmark.runner import main
else:
    from benchmark.runner import main


if __name__ == "__main__":
    raise SystemExit(main())
