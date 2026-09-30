package org.jellyfin.mobile.settings

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import de.Maxr1998.modernpreferences.Preference
import de.Maxr1998.modernpreferences.PreferencesAdapter
import de.Maxr1998.modernpreferences.helpers.categoryHeader
import de.Maxr1998.modernpreferences.helpers.screen
import de.Maxr1998.modernpreferences.helpers.singleChoice
import de.Maxr1998.modernpreferences.preferences.choice.SelectionItem
import org.jellyfin.mobile.R
import org.jellyfin.mobile.app.AppPreferences
import org.jellyfin.mobile.databinding.FragmentSettingsBinding
import org.jellyfin.mobile.utils.BackPressInterceptor
import org.jellyfin.mobile.utils.Constants
import org.jellyfin.mobile.utils.applyWindowInsetsAsMargins
import org.jellyfin.mobile.utils.extensions.requireMainActivity
import org.jellyfin.mobile.utils.withThemedContext
import org.json.JSONArray
import org.koin.android.ext.android.inject
import timber.log.Timber

class ReaderSettingsFragment : Fragment(), BackPressInterceptor {

    private val appPreferences: AppPreferences by inject()
    private val settingsAdapter: PreferencesAdapter by lazy { PreferencesAdapter(buildSettingsScreen()) }

    init {
        Preference.Config.titleMaxLines = 2
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val localInflater = inflater.withThemedContext(requireContext(), R.style.AppTheme_Settings)
        val binding = FragmentSettingsBinding.inflate(localInflater, container, false)
        binding.root.applyWindowInsetsAsMargins()
        val readerTitle = getString(R.string.pref_category_reader_settings)
        binding.toolbar.title = readerTitle
        requireMainActivity().apply {
            setSupportActionBar(binding.toolbar)
            supportActionBar?.setDisplayHomeAsUpEnabled(true)
            supportActionBar?.title = readerTitle
        }
        binding.recyclerView.adapter = settingsAdapter
        return binding.root
    }

    override fun onInterceptBackPressed(): Boolean {
        return settingsAdapter.goBack()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        requireMainActivity().setSupportActionBar(null)
    }

    private fun buildSettingsScreen() = screen(requireContext()) {
        collapseIcon = true

        categoryHeader("pref_reader_category_startup") {
            titleRes = R.string.pref_category_reader_settings
        }

        val startViewOptions = mutableListOf(
            SelectionItem(
                "default",
                R.string.pref_start_view_default,
                R.string.pref_start_view_default_summary
            ),
            SelectionItem(
                "favorites",
                R.string.pref_start_view_favorites,
                R.string.pref_start_view_favorites_summary
            )
        )

        // Add user book libraries dynamically from cache
        try {
            val cache = appPreferences.readerLibrariesCache
            if (cache.isNotEmpty() && cache != "[]") {
                val jsonArray = JSONArray(cache)
                for (i in 0 until jsonArray.length()) {
                    val libObj = jsonArray.getJSONObject(i)
                    val id = libObj.optString("id")
                    val name = libObj.optString("name")
                    if (id.isNotEmpty() && name.isNotEmpty()) {
                        startViewOptions.add(
                            SelectionItem(
                                "library:$id",
                                name,
                                getString(R.string.pref_start_view_library_summary, name)
                            )
                        )
                    }
                }
            }
        } catch (e: Exception) {
            Timber.e("Error loading reader libraries for settings: %s", e.message)
        }

        singleChoice(Constants.PREF_READER_DEFAULT_START_VIEW, startViewOptions) {
            titleRes = R.string.pref_reader_default_start_view_title
            summaryRes = R.string.pref_reader_default_start_view_summary
            initialSelection = appPreferences.readerDefaultStartView
        }
    }
}
