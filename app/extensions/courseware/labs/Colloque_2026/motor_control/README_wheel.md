# Turn the Wheel - Field Oriented Control with hall Sensors.

## Introduction.

This example show how to regulate the torque in a Permanent Magnet Synchonous Machine
(PMSM) using a Field Oriented Control (FOC) algorithm. 

The FOC is well adapted to PMSM with sinusoïdal back-emf (electro
motive forces). The FOC algorithm generate smooth torque value. 
The current regulators (Proportional-Integral) are in the _"dq"_ frame where values
should be constant during steady state operation.

To apply this technique we should have an acquisition of a continuous angle value [0, 2π[.
But for _"cost"_ reasons or integrations with other algorithms (BLDC), some motor have
only 3 discrete hall sensors value to indicate the rotor position.

In this case we use a PLL (Phased-Lock-Loop) filter to _"build"_ a contiuous equivalent
angle from the 3 discrete signals. 

![](Images/foc_hall_scheme.png)

## Import libraries to use it.

This example use some software components which are in the owntech `control_library`.
then you must import it by inserting the following line in the `platformio.ini` file.

```ini 
lib_deps=
 control_library = https://github.com/owntech-foundation/control_library.git
 scopemimicry = https://github.com/owntech-foundation/scopemimicry.git
```

## How the _"sector"_ table is built.

According _"dq"_ transformation, the formula of the back emf should be :

$E_{u} = - K_{fem}.\omega .sin(\theta)$

$E_{v} = - K_{fem}.\omega .sin(\theta - 2\pi/3)$

$E_{w} = - K_{fem}.\omega .sin(\theta - 4\pi/3)$

Where $\theta$ is the _"electric"_ angle and $\omega$ is the _"electric"_ pulsation.

For simplicity reasons we assume that the value $K_{fem}.\omega = 1$.

Then the hall sensors must be synchronised with the hall sensors as the following:

![](Images/bemf_and_hall.png)

According these assumptions, we define a variable `hall_index` which is computed as:

$hall_{index} = Hall_u . 2^0+ Hall_v . 2^1  + Hall_w . 2^2$

We also define a `sector` variable which evolve like a quantification of a continuous
angle value, then we can make a lookup table between these two variables.

![](Images/sector_and_hall_idx.png)

| sector | hall_index |
| ---    | ---        |
| 0      | 3          |
| 1      | 2          |
| 2      | 6          |
| 3      | 4          |
| 4      | 5          |
| 5      | 1          |

## Use this example  

This example is intended to be operated from the Modular dashboard in `../modular`. The dashboard wraps the serial commands of the firmware into buttons for mode changes, torque-reference updates, and scope retrieval.

![](Images/dashboard_ownverter.png)

- Wire the motor hall effect sensors and power phase. The colors of the hall effect sensors should match the color of the power phase.
- Flash the example to the OwnVerter board.
- Launch the Modular dashboard and connect the serial datasource for the OwnVerter.
- Press `OFFSET` first to run the current-offset measurement.
- Press `power` to enter power mode. This starts the motor control loop and arms the scope acquisition.
- At that point, there is no torque reference because `Iq_ref` is equal to `0`.
- Increase the torque reference with `IQ+`. Each click increments the manual torque reference by `0.1 A`.
- Increase the torque reference until the motor starts spinning. Use `IQ-` to reduce the reference if needed.
- Press `idle` to bring the controller back to idle mode and stop the motor.
- Use the fast-frame control widget to retrieve recorded scope data:
  - `Trigger + Retrieve` rearms the acquisition and downloads the latest record in one action.
  - `Retrieve` downloads the last captured record.
  - `Save Latest CSV` stores the retrieved data for later analysis.
- The fast-frame plot widget can then be used to display the recorded channels directly in the dashboard.

The default scope trigger is the transition into power mode, and the dashboard also lets you rearm the acquisition manually before another run.

| Control state | Comment |
| ---    | ---        |
| 0      | In this state, the controller is calculating the current offset      |
| 1      | In this state, the controller is idle          |
| 2      | In this state, the controller is in power mode          |
| 3      | In this state, the controller is in error mode. The error mode is entered by repetedely (repedely being defined by `error_counter`) fulfilling the following condition :  `I1_Low` going beyond the bounds `[-AC_CURRENT_LIMIT;+AC_CURRENT_LIMIT]`, `I2_Low` going beyond the bounds `[-AC_CURRENT_LIMIT;+AC_CURRENT_LIMIT]` or `I_High` exceding `DC_CURRENT_LIMIT` |
