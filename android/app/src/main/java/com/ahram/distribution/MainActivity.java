package com.ahram.distribution;

import com.getcapacitor.BridgeActivity;
import com.ahram.distribution.plugins.TrackingPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(TrackingPlugin.class);
    }
}
