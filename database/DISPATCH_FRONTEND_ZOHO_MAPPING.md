# Dispatch front end to Zoho `Call_Centre` mapping

This is the canonical field map implemented by `CC.dbo.DispatchLink_PushZoho`.
The Zoho names below are API names, not display labels.

## Dispatch fields

| Dispatch front-end field | Form name | `DispatchIncidents` source | Zoho API name | Transformation |
|---|---|---|---|---|
| Registration | `regNo` | `RegNo` | `Reg_No` | Trimmed text |
| Incident date/time | `eventDateTime` | `EventDateTime` | `Date_Time_Case_Opened` | ISO-8601 with `+02:00` |
| Incident type | `event` | `Event` | `Incident_Type` | Trimmed text |
| Department | `dispatchReason` | `DispatchReason` | `Seat` | Trimmed pick-list value |
| Zoho Account | `zohoAccount` | `ZohoAccount` | `Lookup_1` (displayed as Company) | Resolve the selected account name through `Pulsit_comparison.dbo.Accounts_ZOHO`; send `zoho_id`, with the Company + Fleet Code mapping as fallback |
| Client name | `clientName` | `ClientName` | `CONTACT` | Trimmed text |
| Client contact number | `clientContactNumber` | `ClientContactNumber` | `From_To_Alternative` | Trimmed text |
| Client PO | `clientPo` | `ClientPO` | `Client_O_N` | Converted to integer |
| Fleet number | `fleetCode` | `FleetCode` | `FLEET_NUMBER` | Trimmed text |
| Stock number (WRC) | `stockNumberWrc` | `StockNumberWrc` | `Stock_Number` | Trimmed text |
| Trailer Reg 1 | `trailerRegistration1` | `TrailerRegistration1` | `Trailer_Reg_1` | Trimmed text |
| Trailer Reg 2 | `trailerRegistration2` | `TrailerRegistration2` | `Trailer_Reg_2` | Trimmed text |
| Make | `vehicleMake` | `VehicleMake` | `Vehicle_Make` | Trimmed text |
| Model | `vehicleModel` | `VehicleModel` | `Model1` | Trimmed text |
| Vehicle colour | `vehicleColour` | `VehicleColour` | `Colour` | Trimmed text |
| Trailer type | `trailerType` | `TrailerType` | `Trailer_Types` | Trimmed text |
| Markings/branding | `vehicleBranding` | `VehicleBranding` | `Markings_Branding` | Trimmed text |
| Trailer markings/branding | `trailerBranding` | `TrailerBranding` | `Trailer_Markings_Branding` | Trimmed text |
| Dispatch date/time | `dispatchDateTime` | `DispatchDateTime` | `Capital_Air_Dispatched` | ISO-8601 with `+02:00` |
| Dispatch team | `dispatchTeam` | `DispatchTeam` | `Dispatched_Team` | Trimmed text |
| Dispatch Team OB No | `obNumber` | `OBNumber` | `Capital_OB_No` | Operator-entered, trimmed text |
| Stand down date/time | `standDownDateTime` | `StandDownDateTime` | `Capital_Air_Stand_Down` | ISO-8601 with `+02:00` |
| Vehicle recovered | `vehicleRecovered` | `VehicleRecovered` | `Pick_List_6` | Trimmed pick-list value |
| Load recovered | `loadRecovered` | `LoadRecovered` | `Load_Recovered` | Trimmed pick-list value |
| Vehicle key available | `vehicleKeyAvailable` | `VehicleKeyAvailable` | `Vehicle_Key_Available` | Trimmed pick-list value |
| Trailers recovered | `trailersRecovered` | `TrailersRecovered` | `Trailer_s_Recovered` | Trimmed pick-list value |
| Driver on scene | `driverOnScene` | `DriverOnScene` | `Driver_on_Scene` | Trimmed pick-list value |
| Tracking unit status | `trackingUnitStatus` | `TrackingUnitStatus` | `Tracking_Unit_Status` | Trimmed pick-list value |
| Geolocation | `geoLocation` | `GeoLocation` | `Incident_Address` | Trimmed text |
| Summary of Incident | Closure form | `SummaryOfIncident` plus `DispatchIncidentTimeline.EntryText` | `Summary_of_Incident1` | Existing summary first, then visible timeline descriptions in chronological order; one punctuated sentence per line, without dates, times, event labels, deleted entries, or protected handovers |
| Approval comments | Approval editor | `ApprovalComments` | `Comments` | Trimmed text |

## Calculated and workflow fields

| Dispatch source | Zoho API name | Rule |
|---|---|---|
| Registration + incident type | `Name` | `RegNo_IncidentType`, limited to 255 characters |
| Fixed integration value | `CC_Event_Type` | Always `Risk` |
| Dispatch creator | `Operator_Name` | Resolve `CreatedBy` against `Jobcard.dbo.User_info.Username` and send trimmed `Name + ' ' + Surname`; fall back to `CreatedBy` only when the profile name is unavailable |
| Incident time | `Shift_No` | Shift 1: 05:00–12:59; Shift 2: 13:00–20:59; otherwise Shift 3 |
| Dispatch date/team present | `Capital_Air_Dispatched1` | Boolean true when either value exists |
| Approver | `Comments_By` | `ApprovedBy` |
| Approval time | `Date_Time_added` | `ApprovedAt` as ISO-8601 with `+02:00` |
| Public dispatch evidence | `Dispatch_Attachments_WAPP` | `https://dispatch.example.invalid/dispatch_link/public/evidence.html?id={DispatchIncidents.id}` |
| Zoho-generated incident number | `Incident_No` | Read back after creation and stored as `DispatchIncidents.zoho_ob`; this is distinct from the operator-entered dispatch-team OB |
| Manager-approved dispatch | `CLOSED` | Boolean `true`; the procedure processes only approved dispatches |
| Manager approval time | `Date_Time_Event_Closed` | `ApprovedAt` as ISO-8601 with `+02:00` |
| Closed comments | `Summary_of_Incident` | Fixed value `Approved by Control Room Management.` |
| Closed by control room operator | `Closed_by_Control_Room_Operator` | Fixed value `Dispatch Link (Automation)` |
| Existing Zoho record | `id` | Included on PUT updates only |

`Dispatch_Attachments_WAPP` must be writable by the Zoho integration user. On
2026-08-06 the live procedure was confirmed to send the evidence URL, while the
Zoho record still returned this field as `null` and the UI displayed it as read-only.
That Zoho field permission/type must be corrected, or a writable URL field must be
provided; changing the payload value cannot make a read-only field persist.

## Communication Log subform

| Dispatch front-end field | Database source | Zoho API name |
|---|---|---|
| Communication notes | `CommunicationNotes` | `CR_Event_Comments1` |
| Communication type | `CommunicationType` | `CR_Event_Type_of_Comms` |
| Contact person | `ContactPerson` | `CR_Event_Contact_Name` |
| Contact number | `ContactNumber` | `CR_Event_Contact_No` (all whitespace removed before saving and sending) |
| Control room agent | `ControlRoomAgent` | `CR_Event_Control_Room_Agent` |
| Communication date + time | `CommunicationDate` + `CommunicationTime` | `CR_Event_Date_Time_of_Comms` |
| Email address | `EmailAddress` | `Email_Address` |

The rows are sent under the Zoho subform API name `Communication_Log` on record creation.

## Front-end fields without a live Zoho API mapping

The live procedure does not currently send: First ETA, Unit ID, the front-end Company text
field, latitude, longitude, DL number, driver name, driver contact number, recovery date/time,
no-visible-damages, damage notes, ground-team details, incident notes, operator notes,
trailer/stock applicability, or the handover history itself.

These fields must not be assigned guessed API names. Add them only after their exact Zoho
`Call_Centre` API names are confirmed.
