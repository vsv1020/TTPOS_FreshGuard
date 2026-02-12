package com.ttpos.freshguard.admin

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class DashboardActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_dashboard)

        val prefs = getSharedPreferences("auth", MODE_PRIVATE)
        val email = prefs.getString("email", "admin") ?: "admin"

        findViewById<TextView>(R.id.dashboardTitle).text = "Signed in as $email"

        findViewById<Button>(R.id.logoutButton).setOnClickListener {
            prefs.edit().clear().apply()
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }
    }
}
