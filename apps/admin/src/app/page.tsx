"use client";
import dynamic from "next/dynamic";
import LeftPanel from "@/components/LeftPanel";
import RightPanel from "@/components/RightPanel";
import { useAdminData } from "@/lib/useAdminData";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function Page() {
  const data = useAdminData();

  return (
    <div className="shell">
      <div className="header">
        <h1>Redbridge Admin · Flood Command</h1>
        <span className="pill live">LIVE</span>
        <span className="stage-ft">{data.live?.gauge ? `${data.live.gauge.observedFt.toFixed(1)} ft` : "-- ft"}</span>
      </div>

      <LeftPanel live={data.live} mapData={data.mapData} errors={data.errors} />

      <div className="map-wrap">
        <MapView
          mapData={data.mapData}
          dispatches={data.dispatches}
          cameras={data.cameras}
          sensors={data.sensors}
          reports={data.reports}
          onSignalDispatch={data.signalDispatch}
          onAdvanceDispatch={data.setDispatchStatus}
        />
      </div>

      <RightPanel
        mapData={data.mapData}
        dispatches={data.dispatches}
        onSignalDispatch={data.signalDispatch}
        onAdvanceDispatch={data.setDispatchStatus}
        camerasResp={data.camerasResp}
        cameras={data.cameras}
        sensors={data.sensors}
        reports={data.reports}
      />
    </div>
  );
}
