# Movement Threshold Notes

These thresholds are deliberately small and explainable. They should be changed only with replay-test coverage or measured runtime evidence.

## Temporal Confidence

The movement recognition engine uses accumulated confidence rather than trusting a single frame. This reduces flicker when pose landmarks jitter or briefly disappear.

- Activation threshold near `0.7`: a movement should be consistently visible before becoming active.
- Deactivation threshold near `0.42`: once active, the candidate is allowed a small confidence dip before dropping out.
- Candidate threshold near `0.48`: weak movement evidence can remain visible to the engine without being treated as validated activity.

## Cyclic Phase Machine

Push-ups and squats both use the shared top-descend-bottom-return phase machine.

- Hysteresis around `8deg`: prevents rapid phase flipping near top/bottom thresholds.
- Minimum bottom hold around `80ms`: filters accidental threshold touches while keeping normal reps responsive.
- Minimum phase velocity around `12deg/s`: distinguishes real movement from slow posture drift.

## Push-Up Defaults

- Top elbow angle `148deg`: represents a practical lockout without requiring perfectly straight elbows.
- Bottom elbow angle `122deg`: requires visible depth while tolerating home camera noise and body variation.
- Max body-line deviation `0.16`: warns on shoulder-hip-ankle drift without blocking the rep.
- Invalid body-line deviation `0.28`: blocks counting when hip sag or pike makes the rep biomechanically unreliable.
- Side camera is preferred because elbow depth and shoulder-hip-ankle alignment are most explainable from that view.

## Squat Defaults

- Top knee angle `154deg`: represents standing recovery without requiring a locked knee.
- Bottom knee angle `112deg`: requires meaningful depth while avoiding overly strict parallel-depth assumptions.
- Max torso inclination `38deg`: warns when the torso collapses forward enough to affect quality.
- Side camera is preferred for validation because knee depth and torso angle are easier to interpret from the side.

## Body-State And Diagnostics

- Full-body visibility target `0.72`: used as a practical threshold for stable analysis.
- Full-body warning below `0.55`: the system should guide the user to step back or improve framing.
- Low-confidence region below `0.45`: region-specific guidance can call out torso, hands, or feet without failing the entire session.
- Missing-sample ratio above `0.25`: recent tracking gaps are significant enough to surface as guidance.

## Change Policy

When changing thresholds:

- Add or update deterministic replay tests first.
- Prefer normalized body relationships over raw pixel distances.
- Keep separate thresholds for recognition, validation, and guidance.
- Document the product reason, not only the numeric value.
